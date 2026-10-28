import type { Db } from '../../api/src/db';
import { expireOverdue } from '../../api/src/payments/state';
import type { Alerts } from './alerts';
import type { KeeperChain } from './chain';
import { evaluateIntent, findIntentsToEvaluate, type EvalCtx } from './evaluate';
import { loadCursor } from './scanner';
import type { Logger } from './types';
import { deliverDue, enqueueWebhook, type DeliveryCtx } from './webhooks';

export interface ReconcileCtx {
  db: Db;
  chainId: number;
  evalCtx: EvalCtx;
  delivery: DeliveryCtx;
  keeperChain: KeeperChain;
  alerts: Alerts;
  log: Logger;
  now: () => Date;
  config: { CURSOR_LAG_ALERT_SECONDS: number; MIN_KEEPER_BALANCE_WEI: bigint };
}

/**
 * Third loop: housekeeping that does not move money. Expires unpaid intents (only behind the scanner watermark),
 * re-evaluates payments after crashes, retries webhooks, and raises the operational alerts.
 */
export async function reconcileTick(ctx: ReconcileCtx): Promise<void> {
  const cursor = await loadCursor(ctx.db, ctx.chainId);
  const watermark = cursor?.last_block_timestamp ?? null;

  const expired = await expireOverdue(ctx.db, ctx.now(), watermark);
  for (const id of expired) await enqueueWebhook(ctx.db, id, 'payment.expired', ctx.now());
  if (expired.length > 0) ctx.log.info('payments_expired', { count: expired.length });

  for (const id of await findIntentsToEvaluate(ctx.db, ctx.chainId)) {
    try {
      await evaluateIntent(ctx.evalCtx, id);
    } catch (error) {
      ctx.log.error('evaluate_error', { paymentIntentId: id, error: error instanceof Error ? error.message : 'unknown' });
    }
  }

  const result = await deliverDue(ctx.delivery);
  if (result.delivered + result.failed + result.retried > 0) ctx.log.info('webhooks_processed', result);

  // Alert: scanner falling behind. The watermark is chain time of the last scanned block.
  if (watermark) {
    const lagSeconds = Math.floor((ctx.now().getTime() - watermark.getTime()) / 1000);
    if (lagSeconds > ctx.config.CURSOR_LAG_ALERT_SECONDS) ctx.alerts.raise('cursor_lag', `Scanner is ${lagSeconds}s behind the chain`, { lagSeconds });
    else ctx.alerts.clear('cursor_lag');
  }
  // Alert: keeper gas balance.
  const balance = await ctx.keeperChain.keeperBalanceWei();
  if (balance < ctx.config.MIN_KEEPER_BALANCE_WEI) ctx.alerts.raise('keeper_balance_low', 'Keeper gas balance is below the configured minimum', { balanceWei: balance.toString() });
  else ctx.alerts.clear('keeper_balance_low');
}
