import { decodeEventLog, getAddress, type Hex } from 'viem';
import {
  deriveReceiverAddress, distributorAbi, erc20TransferAbi, hashTerms, settlementTypedData,
  type Address, type ContractTerms, type SettlementEvidence,
} from '@acqui/shared';
import type { Db, Q } from '../../api/src/db';
import { markSettled, transition, type PaymentStatus } from '../../api/src/payments/state';
import type { Alerts } from './alerts';
import { encodeSettle, type KeeperChain, type ReceiptInfo } from './chain';
import { openRecoveryCase } from './evaluate';
import type { Logger } from './types';
import { enqueueWebhook } from './webhooks';

export interface AttesterSigner {
  address: Address;
  signTypedData(args: ReturnType<typeof settlementTypedData>): Promise<Hex>;
}

export interface KeeperCtx {
  db: Db;
  chain: KeeperChain;
  attester: AttesterSigner;
  contracts: { chainId: number; distributor: Address; usdc: Address; recoveryDelaySeconds: bigint; deployBlock?: bigint | undefined };
  config: { CONFIRMATIONS: number; MIN_KEEPER_BALANCE_WEI: bigint; STUCK_SETTLEMENT_ALERT_SECONDS: number };
  alerts: Alerts;
  log: Logger;
  now: () => Date;
  sleep: (ms: number) => Promise<void>;
}

export const MAX_SETTLE_ATTEMPTS = 5;
const REBROADCAST_AFTER_MS = 20_000;
const DROPPED_AFTER_MS = 10 * 60_000;

export interface IntentRow {
  id: string; merchant_id: string; status: PaymentStatus; chain_id: number; gross_units: string;
  receiver_address: string; distributor_address: string; terms_hash: string; intent_ref: Hex; attempt_ref: Hex;
  payout_address: string; refund_address: string; fee_bps: number; min_fee_units: string;
  protocol_fee_units: string; keeper_reimbursement_units: string; merchant_net_units: string;
  expires_at: Date; updated_at: Date;
}

interface AttemptRow {
  id: string; attempt_no: number; status: 'pending' | 'submitted' | 'confirmed' | 'failed'; tx_hash: string | null;
  raw_tx: string | null; evidence: { eligibleAmount: string; depositTimestamp: string; evidenceTxHash: Hex; evidenceBlock: string } | null;
  signature: Hex | null; submitted_at: Date | null; error_code: string | null;
}

export function termsOf(r: IntentRow): ContractTerms {
  return {
    intentId: r.intent_ref, attemptId: r.attempt_ref, merchant: getAddress(r.payout_address), refundAddress: getAddress(r.refund_address),
    amount: BigInt(r.gross_units), expiry: BigInt(Math.floor(r.expires_at.getTime() / 1000)), feeBps: r.fee_bps,
    minFee: BigInt(r.min_fee_units), keeperReimbursement: BigInt(r.keeper_reimbursement_units),
  };
}

/** Never sign or send for a row whose stored terms no longer reproduce its committed hash and receiver address. */
function assertIntegrity(ctx: KeeperCtx, r: IntentRow): ContractTerms {
  const terms = termsOf(r);
  const hash = hashTerms(BigInt(r.chain_id), terms);
  const receiver = deriveReceiverAddress(ctx.contracts.distributor, hash).toLowerCase();
  if (hash.toLowerCase() !== r.terms_hash.toLowerCase() || receiver !== r.receiver_address.toLowerCase() ||
      r.distributor_address.toLowerCase() !== ctx.contracts.distributor.toLowerCase() || r.chain_id !== ctx.contracts.chainId) {
    ctx.alerts.raise('terms_integrity_failure', 'Stored payment terms do not reproduce the committed receiver', { paymentIntentId: r.id });
    throw new Error(`terms integrity failure for ${r.id}`);
  }
  return terms;
}

const loadIntent = async (q: Q, id: string) =>
  (await q<IntentRow[]>`SELECT * FROM payment_intents WHERE id = ${id}`)[0];

async function latestLiveAttempt(q: Q, id: string): Promise<AttemptRow | undefined> {
  return (await q<AttemptRow[]>`
    SELECT id, attempt_no, status, tx_hash, raw_tx, evidence, signature, submitted_at, error_code
    FROM settlement_attempts WHERE payment_intent_id = ${id} AND status IN ('pending','submitted') ORDER BY attempt_no DESC LIMIT 1`)[0];
}

/** One keeper pass: advance every payment that needs the keeper, one at a time (single nonce, no races). */
export async function keeperTick(ctx: KeeperCtx): Promise<number> {
  const rows = await ctx.db<{ id: string }[]>`
    SELECT id FROM payment_intents WHERE chain_id = ${ctx.contracts.chainId}
      AND status IN ('verifying','settling','retryable_failure') ORDER BY updated_at LIMIT 25`;
  for (const { id } of rows) {
    try {
      await processPayment(ctx, id);
    } catch (error) {
      ctx.log.error('keeper_payment_error', { paymentIntentId: id, error: error instanceof Error ? error.message : 'unknown' });
    }
  }
  await reportStuck(ctx);
  return rows.length;
}

export async function processPayment(ctx: KeeperCtx, id: string): Promise<void> {
  const intent = await loadIntent(ctx.db, id);
  if (!intent) return;
  if (intent.status === 'verifying') return startAttempt(ctx, intent);
  if (intent.status === 'settling') return driveAttempt(ctx, intent);
  if (intent.status === 'retryable_failure') return retryOrGiveUp(ctx, intent);
}

async function windowClosed(ctx: KeeperCtx, intent: IntentRow): Promise<boolean> {
  const head = await ctx.chain.head();
  const closesAfter = BigInt(Math.floor(intent.expires_at.getTime() / 1000)) + ctx.contracts.recoveryDelaySeconds;
  return head.timestamp > closesAfter;
}

async function giveUp(ctx: KeeperCtx, intent: IntentRow, reason: string): Promise<void> {
  await ctx.db.begin(async (tx) => {
    await transition(tx, intent.id, intent.status, 'recovery_required', reason);
    await openRecoveryCase(tx, intent, 'settlement_failed', false, ctx.contracts.recoveryDelaySeconds, ctx.now());
  });
  ctx.alerts.raise(`settlement_gave_up:${intent.id}`, 'Settlement abandoned, funds will be refunded', { paymentIntentId: intent.id, reason });
}

/** verifying/retryable_failure -> settling: re-verify deposits against the chain, then sign a bounded attestation. */
async function startAttempt(ctx: KeeperCtx, intent: IntentRow): Promise<void> {
  const terms = assertIntegrity(ctx, intent);
  const receiver = getAddress(intent.receiver_address);
  if (await windowClosed(ctx, intent)) return giveUp(ctx, intent, 'settlement window closed');

  const deposits = await ctx.db<{ tx_hash: Hex; log_index: number; block_number: string; block_timestamp: Date; amount_units: string }[]>`
    SELECT tx_hash, log_index, block_number, block_timestamp, amount_units FROM deposits
    WHERE payment_intent_id = ${intent.id} AND on_time ORDER BY block_number, log_index`;
  let cumulative = 0n;
  let crossing: (typeof deposits)[number] | undefined;
  const used: (typeof deposits)[number][] = [];
  for (const d of deposits) {
    used.push(d);
    cumulative += BigInt(d.amount_units);
    if (cumulative >= terms.amount) { crossing = d; break; }
  }
  if (!crossing) return; // not actually covered; the evaluator will correct the status

  for (const d of used) {
    const ok = await ctx.chain.verifyDeposit({ txHash: d.tx_hash, logIndex: d.log_index, receiver, amountUnits: BigInt(d.amount_units) });
    if (!ok) {
      ctx.alerts.raise(`deposit_unverified:${intent.id}`, 'A recorded deposit could not be re-verified on chain', { paymentIntentId: intent.id, txHash: d.tx_hash });
      return;
    }
  }
  const settledAlready = await ctx.chain.isSettledOnchain(receiver);
  if (!settledAlready && (await ctx.chain.usdcBalance(receiver)) < terms.amount) {
    ctx.alerts.raise(`receiver_balance_short:${intent.id}`, 'Receiver holds less than the invoice amount', { paymentIntentId: intent.id });
    return;
  }

  const evidence: SettlementEvidence = {
    eligibleAmount: cumulative, depositTimestamp: BigInt(Math.floor(crossing.block_timestamp.getTime() / 1000)),
    evidenceTxHash: crossing.tx_hash, evidenceBlock: BigInt(crossing.block_number),
  };
  const hash = hashTerms(BigInt(intent.chain_id), terms);
  const signature = settledAlready ? null : await ctx.attester.signTypedData(
    settlementTypedData({ chainId: BigInt(intent.chain_id), verifyingContract: ctx.contracts.distributor }, hash, evidence));
  const stored = { eligibleAmount: evidence.eligibleAmount.toString(), depositTimestamp: evidence.depositTimestamp.toString(), evidenceTxHash: evidence.evidenceTxHash, evidenceBlock: evidence.evidenceBlock.toString() };

  await ctx.db.begin(async (tx) => {
    await transition(tx, intent.id, intent.status, 'settling', 'attestation signed from verified deposits');
    await tx`
      INSERT INTO settlement_attempts (payment_intent_id, attempt_no, chain_id, evidence, signature)
      VALUES (${intent.id}, COALESCE((SELECT max(attempt_no) FROM settlement_attempts WHERE payment_intent_id = ${intent.id}), 0) + 1,
              ${intent.chain_id}, ${tx.json(stored)}, ${signature})`;
  });
  ctx.log.info('settlement_attestation_signed', { paymentIntentId: intent.id });
}

async function retryOrGiveUp(ctx: KeeperCtx, intent: IntentRow): Promise<void> {
  const count = Number((await ctx.db<{ n: string }[]>`SELECT count(*) AS n FROM settlement_attempts WHERE payment_intent_id = ${intent.id}`)[0]?.n ?? 0);
  if (count >= MAX_SETTLE_ATTEMPTS) return giveUp(ctx, intent, `${count} settlement attempts failed`);
  const waitMs = Math.min(15_000 * 2 ** Math.max(0, count - 1), 10 * 60_000);
  const lastFailed = (await ctx.db<{ at: Date | null }[]>`SELECT max(updated_at) AS at FROM settlement_attempts WHERE payment_intent_id = ${intent.id} AND status = 'failed'`)[0]?.at;
  if (lastFailed && ctx.now().getTime() - lastFailed.getTime() < waitMs) return;
  // An earlier tx may have landed after all: settle that question before paying for another attempt.
  if (await ctx.chain.isSettledOnchain(getAddress(intent.receiver_address))) {
    await ctx.db.begin((tx) => transition(tx, intent.id, 'retryable_failure', 'settling', 'payout found on chain'));
    await ctx.db`INSERT INTO settlement_attempts (payment_intent_id, attempt_no, chain_id) VALUES (${intent.id}, ${count + 1}, ${intent.chain_id})`;
    return;
  }
  return startAttempt(ctx, intent);
}

async function failAttempt(ctx: KeeperCtx, intent: IntentRow, attempt: AttemptRow, code: string, detail: string, gasUsed?: bigint): Promise<void> {
  await ctx.db.begin(async (tx) => {
    await tx`UPDATE settlement_attempts SET status = 'failed', error_code = ${code}, error = ${detail.slice(0, 500)},
             gas_used = ${gasUsed?.toString() ?? null}, updated_at = ${ctx.now()} WHERE id = ${attempt.id}`;
    await transition(tx, intent.id, 'settling', 'retryable_failure', `${code}: ${detail.slice(0, 120)}`);
  });
  ctx.log.warn('settlement_attempt_failed', { paymentIntentId: intent.id, attempt: attempt.attempt_no, code });
}

export async function driveAttempt(ctx: KeeperCtx, intent: IntentRow): Promise<void> {
  const terms = assertIntegrity(ctx, intent);
  const receiver = getAddress(intent.receiver_address);
  const attempt = await latestLiveAttempt(ctx.db, intent.id);
  if (!attempt) {
    await ctx.db.begin((tx) => transition(tx, intent.id, 'settling', 'retryable_failure', 'no live settlement attempt'));
    return;
  }

  // Crash recovery rule #1: ask the chain whether the payout already happened before doing anything that costs gas.
  if (await ctx.chain.isSettledOnchain(receiver)) return confirmFromChain(ctx, intent, attempt);

  if (attempt.status === 'submitted' && attempt.tx_hash) {
    const hash = attempt.tx_hash as Hex;
    const receipt = await ctx.chain.getReceipt(hash);
    if (receipt) return handleReceipt(ctx, intent, attempt, receipt);
    const age = ctx.now().getTime() - (attempt.submitted_at?.getTime() ?? 0);
    if (await ctx.chain.isKnownPending(hash)) {
      return;
    }
    if (age > DROPPED_AFTER_MS) return failAttempt(ctx, intent, attempt, 'dropped', 'transaction never mined');
    if (age > REBROADCAST_AFTER_MS && attempt.raw_tx) await ctx.chain.broadcast(attempt.raw_tx as Hex); // same signed bytes: idempotent
    return;
  }

  // pending -> build, check, persist, then broadcast.
  if (await windowClosed(ctx, intent)) {
    await ctx.db`UPDATE settlement_attempts SET status = 'failed', error_code = 'window_closed', updated_at = now() WHERE id = ${attempt.id}`;
    await ctx.db.begin(async (tx) => {
      await transition(tx, intent.id, 'settling', 'retryable_failure', 'window closed');
    });
    return;
  }
  if (!attempt.evidence || !attempt.signature) {
    await failAttempt(ctx, intent, attempt, 'no_attestation', 'attempt has no signed evidence');
    return;
  }
  const data = encodeSettle(terms, {
    eligibleAmount: BigInt(attempt.evidence.eligibleAmount), depositTimestamp: BigInt(attempt.evidence.depositTimestamp),
    evidenceTxHash: attempt.evidence.evidenceTxHash, evidenceBlock: BigInt(attempt.evidence.evidenceBlock),
  }, attempt.signature);

  const sim = await ctx.chain.simulate(data);
  if (!sim.ok) {
    if (sim.error === 'AlreadySettled') return confirmFromChain(ctx, intent, attempt);
    return failAttempt(ctx, intent, attempt, sim.error, sim.detail); // no transaction sent, no gas spent
  }
  const signed = await ctx.chain.prepare(data, (sim.gas * 12n) / 10n);
  const balance = await ctx.chain.keeperBalanceWei();
  if (balance < signed.maxCostWei + ctx.config.MIN_KEEPER_BALANCE_WEI / 10n) {
    await ctx.db`UPDATE settlement_attempts SET error_code = 'insufficient_gas', updated_at = now() WHERE id = ${attempt.id}`;
    ctx.alerts.raise('keeper_gas_shortage', 'Keeper wallet cannot cover gas, settlements are waiting', { balanceWei: balance.toString(), neededWei: signed.maxCostWei.toString() });
    return;
  }
  ctx.alerts.clear('keeper_gas_shortage');
  // Persist the signed bytes BEFORE broadcasting: after a crash the exact transaction can be found or re-sent, never re-signed.
  // Compare-and-set: if another pass already claimed this attempt, this one must not broadcast a second transaction.
  const claimed = await ctx.db`
    UPDATE settlement_attempts SET status = 'submitted', tx_hash = ${signed.hash}, raw_tx = ${signed.raw}, nonce = ${signed.nonce},
      submitted_at = ${ctx.now()}, error_code = NULL, updated_at = now() WHERE id = ${attempt.id} AND status = 'pending' RETURNING id`;
  if (claimed.length === 0) return;
  await ctx.chain.broadcast(signed.raw);
  ctx.log.info('settlement_broadcast', { paymentIntentId: intent.id, txHash: signed.hash });

  for (let i = 0; i < 20; i += 1) {
    await ctx.sleep(500);
    const receipt = await ctx.chain.getReceipt(signed.hash);
    if (receipt) {
      const live = (await latestLiveAttempt(ctx.db, intent.id)) ?? { ...attempt, status: 'submitted' as const, tx_hash: signed.hash };
      return handleReceipt(ctx, intent, live, receipt);
    }
  }
}

async function handleReceipt(ctx: KeeperCtx, intent: IntentRow, attempt: AttemptRow, receipt: ReceiptInfo): Promise<void> {
  if (receipt.status === 'reverted') {
    await failAttempt(ctx, intent, attempt, 'reverted', `transaction ${attempt.tx_hash ?? ''} reverted`, receipt.gasUsed);
    ctx.alerts.raise(`settlement_reverted:${intent.id}`, 'A settlement transaction reverted onchain', { paymentIntentId: intent.id, txHash: attempt.tx_hash });
    return;
  }
  const head = await ctx.chain.head();
  if (head.number + 1n < receipt.blockNumber + BigInt(ctx.config.CONFIRMATIONS)) return; // wait for depth
  await confirmReceipt(ctx, intent, attempt, attempt.tx_hash as Hex, receipt);
}

async function confirmFromChain(ctx: KeeperCtx, intent: IntentRow, attempt: AttemptRow): Promise<void> {
  const head = await ctx.chain.head();
  const fromBlock = ctx.contracts.deployBlock ?? (head.number > 50_000n ? head.number - 50_000n : 0n);
  const log = await ctx.chain.findSettledLog(getAddress(intent.receiver_address), fromBlock);
  if (!log) {
    ctx.alerts.raise(`settled_log_missing:${intent.id}`, 'Receiver is settled onchain but the PaymentSettled log was not found', { paymentIntentId: intent.id });
    return;
  }
  const receipt = await ctx.chain.getReceipt(log.transactionHash);
  if (!receipt || receipt.status !== 'success') return;
  if (head.number + 1n < receipt.blockNumber + BigInt(ctx.config.CONFIRMATIONS)) return;
  await confirmReceipt(ctx, intent, attempt, log.transactionHash, receipt);
}

/** The only place a payment becomes `settled`: decoded PaymentSettled log AND the merchant's USDC payout leg both match the snapshot. */
async function confirmReceipt(ctx: KeeperCtx, intent: IntentRow, attempt: AttemptRow, txHash: Hex, receipt: ReceiptInfo): Promise<void> {
  const receiver = getAddress(intent.receiver_address);
  let settled: { logIndex: number; gross: bigint; fee: bigint; keeperReimbursement: bigint; merchantNet: bigint; merchant: Address } | undefined;
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== ctx.contracts.distributor.toLowerCase()) continue;
    try {
      const ev = decodeEventLog({ abi: distributorAbi, data: log.data, topics: log.topics as [Hex, ...Hex[]] });
      if (ev.eventName === 'PaymentSettled' && ev.args.receiver.toLowerCase() === receiver.toLowerCase()) {
        settled = { logIndex: log.logIndex, gross: ev.args.gross, fee: ev.args.fee, keeperReimbursement: ev.args.keeperReimbursement, merchantNet: ev.args.merchantNet, merchant: ev.args.merchant };
      }
    } catch { /* unrelated log */ }
  }
  if (!settled) {
    ctx.alerts.raise(`settled_event_missing:${intent.id}`, 'Successful transaction without a PaymentSettled event for this receiver', { paymentIntentId: intent.id, txHash });
    return;
  }
  const payoutSeen = receipt.logs.some((log) => {
    if (log.address.toLowerCase() !== ctx.contracts.usdc.toLowerCase()) return false;
    try {
      const ev = decodeEventLog({ abi: erc20TransferAbi, data: log.data, topics: log.topics as [Hex, ...Hex[]] });
      return ev.args.from.toLowerCase() === receiver.toLowerCase() && ev.args.to.toLowerCase() === settled.merchant.toLowerCase() && ev.args.value === settled.merchantNet;
    } catch { return false; }
  });
  if (!payoutSeen) {
    ctx.alerts.raise(`payout_leg_missing:${intent.id}`, 'No USDC transfer to the merchant found in the settlement receipt', { paymentIntentId: intent.id, txHash });
    return;
  }
  await ctx.db.begin(async (tx) => {
    await markSettled(tx, intent.id, { txHash, blockNumber: receipt.blockNumber, ...settled }, ctx.now());
    await tx`UPDATE settlement_attempts SET status = 'confirmed', tx_hash = ${txHash.toLowerCase()}, receipt_block = ${receipt.blockNumber.toString()},
             gas_used = ${receipt.gasUsed.toString()}, error_code = NULL, updated_at = now() WHERE id = ${attempt.id}`;
    await enqueueWebhook(tx, intent.id, 'payment.settled', ctx.now());
  });
  ctx.alerts.clear(`settlement_reverted:${intent.id}`);
  ctx.log.info('payment_settled', { paymentIntentId: intent.id, txHash });
  // Reimbursement vs the keeper's real gas cost, so an under-priced reimbursement is visible early.
  const gasCostWei = receipt.gasUsed * receipt.effectiveGasPrice;
  if (gasCostWei > settled.keeperReimbursement * 1_000_000_000_000n) {
    ctx.log.warn('reimbursement_below_gas_cost', { paymentIntentId: intent.id, gasCostWei: gasCostWei.toString(), reimbursementUnits: settled.keeperReimbursement.toString() });
  }
}

async function reportStuck(ctx: KeeperCtx): Promise<void> {
  const cutoff = new Date(ctx.now().getTime() - ctx.config.STUCK_SETTLEMENT_ALERT_SECONDS * 1000);
  const rows = await ctx.db<{ n: string }[]>`
    SELECT count(*) AS n FROM payment_intents WHERE chain_id = ${ctx.contracts.chainId}
      AND status IN ('verifying','settling','retryable_failure') AND updated_at < ${cutoff}`;
  const n = Number(rows[0]?.n ?? 0);
  if (n > 0) ctx.alerts.raise('stuck_settlements', `${n} payment(s) have been waiting for settlement`, { count: n });
  else ctx.alerts.clear('stuck_settlements');
}
