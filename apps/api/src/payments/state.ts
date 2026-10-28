import type { Q } from '../db';

export const PAYMENT_STATUSES = [
  'created', 'awaiting_payment', 'deposit_detected', 'verifying', 'settling', 'settled',
  'expired', 'underpaid', 'recovery_required', 'retryable_failure',
] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

/** The only legal moves. Anything else is a bug and is rejected inside the same transaction. */
export const TRANSITIONS: Readonly<Record<PaymentStatus, readonly PaymentStatus[]>> = {
  created: ['awaiting_payment'],
  awaiting_payment: ['deposit_detected', 'expired'],
  deposit_detected: ['verifying', 'underpaid', 'recovery_required'],
  verifying: ['settling', 'underpaid', 'recovery_required'],
  settling: ['settled', 'retryable_failure'],
  retryable_failure: ['settling', 'recovery_required'],
  underpaid: ['deposit_detected', 'recovery_required', 'expired'],
  expired: ['recovery_required'],
  recovery_required: [],
  settled: [],
};

export class StateTransitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StateTransitionError';
  }
}

/** Atomic compare-and-set: only moves when the row is still in `from`, and records an audit event. */
export async function transition(
  q: Q,
  paymentIntentId: string,
  from: PaymentStatus,
  to: PaymentStatus,
  reason: string,
): Promise<void> {
  if (!TRANSITIONS[from].includes(to)) throw new StateTransitionError(`Illegal transition ${from} -> ${to}`);
  if (to === 'settled') throw new StateTransitionError('Use markSettled: settled needs a confirmed payout receipt');
  const rows = await q<{ id: string }[]>`
    UPDATE payment_intents SET status = ${to}, updated_at = now()
    WHERE id = ${paymentIntentId} AND status = ${from} RETURNING id`;
  if (rows.length === 0) throw new StateTransitionError(`Payment is no longer ${from}`);
  await q`
    INSERT INTO payment_status_events (payment_intent_id, from_status, to_status, reason)
    VALUES (${paymentIntentId}, ${from}, ${to}, ${reason})`;
}

export interface SettlementReceipt {
  txHash: string;
  logIndex: number;
  blockNumber: bigint;
  gross: bigint;
  fee: bigint;
  keeperReimbursement: bigint;
  merchantNet: bigint;
  merchant: string;
}

/**
 * The only path to `settled`. The caller passes the decoded PaymentSettled log of a confirmed transaction;
 * every figure and the merchant must equal the snapshot taken at intent creation or nothing changes.
 */
export async function markSettled(q: Q, paymentIntentId: string, r: SettlementReceipt, now: Date): Promise<void> {
  const rows = await q<{
    gross_units: string; protocol_fee_units: string; keeper_reimbursement_units: string;
    merchant_net_units: string; payout_address: string;
  }[]>`
    SELECT gross_units, protocol_fee_units, keeper_reimbursement_units, merchant_net_units, payout_address
    FROM payment_intents WHERE id = ${paymentIntentId} AND status = 'settling' FOR UPDATE`;
  const row = rows[0];
  if (!row) throw new StateTransitionError('Payment is not settling');
  if (
    BigInt(row.gross_units) !== r.gross || BigInt(row.protocol_fee_units) !== r.fee ||
    BigInt(row.keeper_reimbursement_units) !== r.keeperReimbursement ||
    BigInt(row.merchant_net_units) !== r.merchantNet || row.payout_address !== r.merchant.toLowerCase()
  ) {
    throw new StateTransitionError('Settlement receipt does not match the payment snapshot');
  }
  await q`
    UPDATE payment_intents
    SET status = 'settled', settlement_tx_hash = ${r.txHash.toLowerCase()}, settlement_log_index = ${r.logIndex},
        settlement_block = ${r.blockNumber.toString()}, settled_at = ${now}, updated_at = now()
    WHERE id = ${paymentIntentId} AND status = 'settling'`;
  await q`
    INSERT INTO payment_status_events (payment_intent_id, from_status, to_status, reason)
    VALUES (${paymentIntentId}, 'settling', 'settled', 'payout receipt confirmed')`;
}

export interface DepositInput {
  paymentIntentId: string;
  chainId: number;
  txHash: string;
  logIndex: number;
  blockNumber: bigint;
  blockTimestamp: Date;
  fromAddress: string | null;
  amountUnits: bigint;
  onTime: boolean;
}

/** Idempotent per chain event key (chain, tx, log index). Returns false for a duplicate event. */
export async function recordDeposit(q: Q, d: DepositInput): Promise<boolean> {
  const inserted = await q<{ id: string }[]>`
    INSERT INTO deposits (payment_intent_id, chain_id, tx_hash, log_index, block_number, block_timestamp, from_address, amount_units, on_time)
    VALUES (${d.paymentIntentId}, ${d.chainId}, ${d.txHash.toLowerCase()}, ${d.logIndex}, ${d.blockNumber.toString()},
            ${d.blockTimestamp}, ${d.fromAddress?.toLowerCase() ?? null}, ${d.amountUnits.toString()}, ${d.onTime})
    ON CONFLICT (chain_id, tx_hash, log_index) DO NOTHING RETURNING id`;
  if (inserted.length === 0) return false;
  if (d.onTime) {
    const moved = await q<{ id: string }[]>`
      UPDATE payment_intents SET status = 'deposit_detected', updated_at = now()
      WHERE id = ${d.paymentIntentId} AND status IN ('awaiting_payment','underpaid') RETURNING id`;
    if (moved.length > 0) {
      await q`
        INSERT INTO payment_status_events (payment_intent_id, from_status, to_status, reason)
        VALUES (${d.paymentIntentId}, NULL, 'deposit_detected', 'on-time deposit recorded')`;
    }
  }
  return true;
}

/**
 * Expires intents that never saw an on-time deposit and returns their ids. Two clocks must agree:
 * the wall clock, and the scanner watermark (timestamp of the last fully scanned block). Without the second,
 * an on-time deposit that the scanner has not read yet could be missed. A null watermark expires nothing.
 */
export async function expireOverdue(q: Q, now: Date, watermark: Date | null): Promise<string[]> {
  if (watermark === null) return [];
  const rows = await q<{ id: string }[]>`
    UPDATE payment_intents SET status = 'expired', updated_at = now()
    WHERE status = 'awaiting_payment' AND expires_at <= ${now} AND expires_at < ${watermark}
      AND NOT EXISTS (SELECT 1 FROM deposits d WHERE d.payment_intent_id = payment_intents.id)
    RETURNING id`;
  for (const row of rows) {
    await q`
      INSERT INTO payment_status_events (payment_intent_id, from_status, to_status, reason)
      VALUES (${row.id}, 'awaiting_payment', 'expired', 'checkout window elapsed')`;
  }
  return rows.map((r) => r.id);
}
