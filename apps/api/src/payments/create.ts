import { randomUUID } from 'node:crypto';
import { keccak256, stringToHex } from 'viem';
import {
  CHECKOUT_WINDOW_SECONDS, computeGatewayFee, deriveReceiverAddress, hashTerms, protocolFeeTerms,
  type Address, type ContractTerms, type Hex,
} from '@acqui/shared';
import type { AppDeps, MerchantRow } from '../context';
import type { Q } from '../db';
import { conflict, unavailable, unprocessable } from '../lib/errors';
import { randomToken, sha256 } from '../lib/crypto';
import { parseReturnUrl } from '../lib/urls';
import type { CreatePaymentIntentInput } from '../schemas';
import { transition } from './state';
import type { PaymentRow } from './views';

export interface CreateResult {
  row: PaymentRow;
  replayed: boolean;
}

const selectByKey = (q: Q, merchantId: string, chainId: number, key: string) => q<(PaymentRow & { request_hash: Buffer })[]>`
  SELECT * FROM payment_intents
  WHERE merchant_id = ${merchantId} AND chain_id = ${chainId} AND idempotency_key = ${key}`;

function requestHash(input: CreatePaymentIntentInput): Buffer {
  return sha256(JSON.stringify([
    input.amount.toString(), input.order_id, input.description ?? null,
    input.success_url ?? null, input.cancel_url ?? null, input.refund_address ?? null,
  ]));
}

function replay(existing: (PaymentRow & { request_hash: Buffer }) | undefined, hash: Buffer): CreateResult | null {
  if (!existing) return null;
  if (!existing.request_hash.equals(hash)) {
    throw unprocessable('idempotency_key_reused', 'This Idempotency-Key was already used with different parameters');
  }
  return { row: existing, replayed: true };
}

/**
 * Creates a 30-minute payment intent with a fresh deterministic receiver. The receiver address is derived
 * offline from the exact terms the contract will enforce; nothing is deployed or "paid" here.
 */
export async function createPaymentIntent(
  deps: AppDeps,
  merchant: MerchantRow,
  idempotencyKey: string,
  input: CreatePaymentIntentInput,
): Promise<CreateResult> {
  const { db, config, contracts } = deps;
  const hash = requestHash(input);

  // A retry with the same key returns the stored intent, even after it has expired. A new attempt needs a new key.
  if (!contracts) throw unavailable('contracts_not_configured', 'Payment contracts are not configured or could not be verified');
  const prior = replay((await selectByKey(db, merchant.id, contracts.chainId, idempotencyKey))[0], hash);
  if (prior) return prior;
  const reimbursement = config.KEEPER_REIMBURSEMENT_USDC;
  if (reimbursement === undefined) throw unavailable('keeper_reimbursement_not_configured', 'Keeper reimbursement is not configured');
  if (reimbursement > contracts.maxKeeperReimbursement) {
    throw unavailable('keeper_reimbursement_invalid', 'Configured reimbursement exceeds the contract limit');
  }
  const payout = merchant.payout_address;
  if (!payout) throw conflict('payout_not_configured', 'Configure and review a payout address before creating payments');

  const production = config.NODE_ENV === 'production';
  const successUrl = input.success_url ? parseReturnUrl(input.success_url, merchant.allowed_return_origin, 'success_url', production) : null;
  const cancelUrl = input.cancel_url ? parseReturnUrl(input.cancel_url, merchant.allowed_return_origin, 'cancel_url', production) : null;

  // Refunds default to the merchant payout address (merchant refunds off-chain). See docs/OPEN_QUESTIONS.md.
  const refund = (input.refund_address ?? payout).toLowerCase() as Address;
  for (const address of new Set([payout, refund])) {
    let blocked: boolean;
    try {
      blocked = await deps.chain.isBlacklisted(address as Address);
    } catch {
      throw unavailable('chain_unavailable', 'Could not verify addresses against the chain, try again');
    }
    if (blocked) throw unprocessable('address_blocklisted', 'An address on this payment is blocklisted by the USDC issuer');
  }

  const gross = input.amount;
  const fee = computeGatewayFee(gross);
  const merchantNet = gross - fee - reimbursement;
  if (merchantNet <= 0n) throw unprocessable('amount_too_small', 'Amount does not cover fees');

  const now = deps.now();
  const id = randomUUID();
  const publicId = randomToken(16);
  const expiresAt = new Date(now.getTime() + CHECKOUT_WINDOW_SECONDS * 1000);
  const intentRef = keccak256(stringToHex(publicId));
  const attemptRef = keccak256(stringToHex(`${publicId}:1`));
  const terms: ContractTerms = {
    intentId: intentRef, attemptId: attemptRef,
    merchant: payout as Address, refundAddress: refund,
    amount: gross, expiry: BigInt(Math.floor(expiresAt.getTime() / 1000)),
    keeperReimbursement: reimbursement, ...protocolFeeTerms(),
  };
  const termsHash: Hex = hashTerms(BigInt(contracts.chainId), terms);
  const receiver = deriveReceiverAddress(contracts.distributor, termsHash).toLowerCase();

  try {
    const row = await db.begin(async (tx) => {
      await tx`
        INSERT INTO payment_intents (
          id, public_id, merchant_id, order_id, description, idempotency_key, request_hash, chain_id, network, currency,
          gross_units, receiver_address, distributor_address, terms_hash, intent_ref, attempt_ref, payout_address,
          refund_address, fee_bps, min_fee_units, protocol_fee_units, keeper_reimbursement_units, merchant_net_units,
          success_url, cancel_url, created_at, expires_at)
        VALUES (
          ${id}, ${publicId}, ${merchant.id}, ${input.order_id}, ${input.description ?? null}, ${idempotencyKey}, ${hash},
          ${contracts.chainId}, 'arc', 'USDC', ${gross.toString()}, ${receiver}, ${contracts.distributor.toLowerCase()},
          ${termsHash}, ${intentRef}, ${attemptRef}, ${payout}, ${refund}, ${terms.feeBps}, ${terms.minFee.toString()},
          ${fee.toString()}, ${reimbursement.toString()}, ${merchantNet.toString()}, ${successUrl}, ${cancelUrl},
          ${now}, ${expiresAt})`;
      await tx`
        INSERT INTO payment_status_events (payment_intent_id, from_status, to_status, reason)
        VALUES (${id}, NULL, 'created', 'intent created')`;
      await transition(tx, id, 'created', 'awaiting_payment', 'receiver derived, awaiting deposit');
      const rows = await tx<PaymentRow[]>`SELECT * FROM payment_intents WHERE id = ${id}`;
      const created = rows[0];
      if (!created) throw new Error('inserted intent missing');
      return created;
    });
    return { row, replayed: false };
  } catch (error) {
    // Concurrent request with the same key: the unique constraint decides, the loser returns the winner's row.
    if (isUniqueViolation(error, 'payment_intents_idem')) {
      const winner = replay((await selectByKey(db, merchant.id, contracts.chainId, idempotencyKey))[0], hash);
      if (winner) return winner;
    }
    throw error;
  }
}

function isUniqueViolation(error: unknown, constraint: string): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && 'constraint_name' in error &&
    (error as { code: unknown }).code === '23505' && (error as { constraint_name: unknown }).constraint_name === constraint;
}
