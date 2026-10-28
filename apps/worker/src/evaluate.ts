import type { Db, Q } from '../../api/src/db';
import { transition, type PaymentStatus } from '../../api/src/payments/state';
import { loadWatermark } from './scanner';
import type { Logger } from './types';

export interface EvalCtx {
  db: Db;
  chainId: number;
  recoveryDelaySeconds: bigint;
  log: Logger;
  now: () => Date;
}

interface IntentRow {
  id: string;
  status: PaymentStatus;
  gross_units: string;
  expires_at: Date;
}

export type RecoveryReason = 'underpaid' | 'late' | 'overpaid' | 'settlement_failed';

export async function openRecoveryCase(
  q: Q,
  intent: { id: string; expires_at: Date },
  reason: RecoveryReason,
  afterSettlement: boolean,
  recoveryDelaySeconds: bigint,
  now: Date,
): Promise<void> {
  // Unsettled funds may only be returned after the contract's grace period; after settlement, immediately.
  const executableAt = afterSettlement ? now : new Date(intent.expires_at.getTime() + Number(recoveryDelaySeconds) * 1000);
  await q`
    INSERT INTO recovery_cases (payment_intent_id, merchant_id, reason, refund_address, after_settlement, executable_at)
    SELECT id, merchant_id, ${reason}, refund_address, ${afterSettlement}, ${executableAt}
    FROM payment_intents WHERE id = ${intent.id}
    ON CONFLICT (payment_intent_id) WHERE status IN ('open','submitted') DO NOTHING`;
}

/**
 * Applies the eligibility rules to one payment inside a transaction (row locked), using only the database:
 * deposits carry the chain inclusion timestamp and the scanner watermark proves nothing earlier is missing.
 *  - on-time deposits covering the invoice  -> verifying (the keeper re-checks on chain before signing)
 *  - expiry passed (watermark beyond it) with less than the invoice -> underpaid + recovery case
 *  - only late deposits, or late deposits after expiry -> recovery_required + recovery case (never settled)
 *  - settled/closed payments holding more money than owed -> recovery case for the excess
 */
export async function evaluateIntent(ctx: EvalCtx, intentId: string): Promise<void> {
  await ctx.db.begin(async (tx) => {
    const rows = await tx<IntentRow[]>`
      SELECT id, status, gross_units, expires_at FROM payment_intents WHERE id = ${intentId} FOR UPDATE`;
    const intent = rows[0];
    if (!intent) return;
    const gross = BigInt(intent.gross_units);
    const expirySec = BigInt(Math.floor(intent.expires_at.getTime() / 1000));

    const sums = await tx<{ on_time: string; late: string }[]>`
      SELECT COALESCE(SUM(amount_units) FILTER (WHERE on_time), 0) AS on_time,
             COALESCE(SUM(amount_units) FILTER (WHERE NOT on_time), 0) AS late
      FROM deposits WHERE payment_intent_id = ${intent.id}`;
    const onTime = BigInt(sums[0]?.on_time ?? '0');
    const late = BigInt(sums[0]?.late ?? '0');
    const recovered = BigInt((await tx<{ s: string }[]>`
      SELECT COALESCE(SUM(amount_units), 0) AS s FROM recovery_cases WHERE payment_intent_id = ${intent.id} AND status = 'recovered'`)[0]?.s ?? '0');
    const watermark = await loadWatermark(tx, ctx.chainId);
    const pastExpiry = watermark !== null && BigInt(Math.floor(watermark.getTime() / 1000)) > expirySec;
    const now = ctx.now();
    let status = intent.status;

    if (status === 'awaiting_payment') {
      if (onTime > 0n) {
        await transition(tx, intent.id, status, 'deposit_detected', 'on-time deposit seen');
        status = 'deposit_detected';
      } else if (late > 0n) {
        await transition(tx, intent.id, status, 'expired', 'only late deposits');
        status = 'expired';
      }
    }
    if (status === 'deposit_detected') {
      if (onTime >= gross) {
        await transition(tx, intent.id, status, 'verifying', 'on-time deposits cover the invoice');
        ctx.log.info('payment_verifying', { paymentIntentId: intent.id });
        return;
      }
      if (pastExpiry) {
        await transition(tx, intent.id, status, 'underpaid', 'expired with partial payment');
        await openRecoveryCase(tx, intent, 'underpaid', false, ctx.recoveryDelaySeconds, now);
        ctx.log.warn('payment_underpaid', { paymentIntentId: intent.id, onTime: onTime.toString(), gross: gross.toString() });
        return;
      }
    }
    if (status === 'expired' && late > 0n) {
      await transition(tx, intent.id, status, 'recovery_required', 'late deposit on an expired invoice');
      await openRecoveryCase(tx, intent, 'late', false, ctx.recoveryDelaySeconds, now);
      ctx.log.warn('payment_late_deposit', { paymentIntentId: intent.id, late: late.toString() });
      return;
    }

    // Money that is not owed to the merchant (overpayment, later deposits) must always have a path back.
    const total = onTime + late;
    const owed = status === 'settled' ? gross : 0n;
    const unrecovered = total - owed - recovered;
    const closedOut = status === 'settled' || status === 'recovery_required' || status === 'underpaid' || status === 'expired';
    if (closedOut && unrecovered > 0n) {
      const reason: RecoveryReason = status === 'settled' ? 'overpaid' : status === 'underpaid' ? 'underpaid' : 'late';
      await openRecoveryCase(tx, intent, reason, status === 'settled', ctx.recoveryDelaySeconds, now);
    }
  });
}

/** Payments that may need attention. Cheap enough to run every reconcile tick; also repairs after a crash. */
export async function findIntentsToEvaluate(db: Db, chainId: number, limit = 200): Promise<string[]> {
  const rows = await db<{ id: string }[]>`
    SELECT p.id FROM payment_intents p
    LEFT JOIN LATERAL (SELECT COALESCE(SUM(amount_units), 0) AS total FROM deposits d WHERE d.payment_intent_id = p.id) t ON true
    LEFT JOIN LATERAL (SELECT COALESCE(SUM(amount_units), 0) AS rec FROM recovery_cases r WHERE r.payment_intent_id = p.id AND r.status = 'recovered') r ON true
    WHERE p.chain_id = ${chainId} AND (
      p.status = 'deposit_detected'
      OR (p.status IN ('awaiting_payment','expired') AND t.total > 0)
      OR (p.status IN ('settled','recovery_required','underpaid','expired')
          AND t.total - r.rec - (CASE WHEN p.status = 'settled' THEN p.gross_units ELSE 0 END) > 0
          AND NOT EXISTS (SELECT 1 FROM recovery_cases c WHERE c.payment_intent_id = p.id AND c.status IN ('open','submitted'))))
    ORDER BY p.created_at LIMIT ${limit}`;
  return rows.map((r) => r.id);
}
