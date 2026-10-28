import { decodeEventLog, type Hex } from 'viem';
import { distributorAbi, type Address } from '@acqui/shared';
import type { Db } from '../../api/src/db';
import { transition } from '../../api/src/payments/state';
import type { Alerts } from './alerts';
import { encodeRecover, type KeeperChain } from './chain';
import { termsOf, type IntentRow } from './keeper';
import type { Logger } from './types';

export interface RecoveryCtx {
  db: Db;
  chain: KeeperChain;
  contracts: { chainId: number; distributor: Address };
  autoExecute: boolean;
  minBalanceWei: bigint;
  alerts: Alerts;
  log: Logger;
  now: () => Date;
  sleep: (ms: number) => Promise<void>;
}

interface CaseRow { id: string; status: 'open' | 'submitted'; payment_intent_id: string; after_settlement: boolean; recovery_tx_hash: string | null; executable_at: Date }

/**
 * Returns stranded money (underpayments, late deposits, overpayments) to the refund address committed in the receiver.
 * The contract decides what is allowed: this loop only calls `recover(terms)` once the contract's grace period is over
 * (chain time, not wall clock), and the money can only go to the committed refund address whoever calls it.
 */
export async function recoveryTick(ctx: RecoveryCtx): Promise<number> {
  const head = await ctx.chain.head();
  const cases = await ctx.db<CaseRow[]>`
    SELECT c.id, c.status, c.payment_intent_id, c.after_settlement, c.recovery_tx_hash, c.executable_at
    FROM recovery_cases c JOIN payment_intents p ON p.id = c.payment_intent_id
    WHERE c.status IN ('open','submitted') AND p.chain_id = ${ctx.contracts.chainId} ORDER BY c.created_at LIMIT 20`;
  let handled = 0;
  for (const c of cases) {
    try {
      if (c.status === 'submitted') {
        await checkSubmitted(ctx, c);
        handled += 1;
        continue;
      }
      if (BigInt(Math.floor(c.executable_at.getTime() / 1000)) > head.timestamp) continue; // contract would refuse: still in the grace window
      const intent = (await ctx.db<IntentRow[]>`SELECT * FROM payment_intents WHERE id = ${c.payment_intent_id}`)[0];
      if (!intent) continue;
      if (intent.status === 'underpaid') {
        await ctx.db.begin((tx) => transition(tx, intent.id, 'underpaid', 'recovery_required', 'grace period over, refund due'));
      }
      if (!ctx.autoExecute) continue;
      await execute(ctx, c, intent);
      handled += 1;
    } catch (error) {
      ctx.log.error('recovery_error', { caseId: c.id, error: error instanceof Error ? error.message : 'unknown' });
    }
  }
  return handled;
}

async function execute(ctx: RecoveryCtx, c: CaseRow, intent: IntentRow): Promise<void> {
  const data = encodeRecover(termsOf(intent));
  const sim = await ctx.chain.simulate(data);
  if (!sim.ok) {
    if (sim.error === 'NothingToRecover') {
      await ctx.db`UPDATE recovery_cases SET status = 'closed', error = 'nothing to recover', updated_at = now() WHERE id = ${c.id}`;
    } else if (sim.error !== 'RecoveryNotOpen') {
      await ctx.db`UPDATE recovery_cases SET error = ${`${sim.error}: ${sim.detail}`.slice(0, 300)}, updated_at = now() WHERE id = ${c.id}`;
      ctx.alerts.raise(`recovery_blocked:${c.id}`, 'Recovery cannot be executed (for example a blocklisted refund address)', { caseId: c.id, error: sim.error });
    }
    return;
  }
  const signed = await ctx.chain.prepare(data, (sim.gas * 12n) / 10n);
  if ((await ctx.chain.keeperBalanceWei()) < signed.maxCostWei + ctx.minBalanceWei / 10n) {
    ctx.alerts.raise('keeper_gas_shortage', 'Keeper wallet cannot cover gas, recoveries are waiting', {});
    return;
  }
  await ctx.db`UPDATE recovery_cases SET status = 'submitted', recovery_tx_hash = ${signed.hash}, updated_at = now() WHERE id = ${c.id}`;
  await ctx.chain.broadcast(signed.raw);
  for (let i = 0; i < 20; i += 1) {
    await ctx.sleep(500);
    if (await ctx.chain.getReceipt(signed.hash)) return checkSubmitted(ctx, { ...c, status: 'submitted', recovery_tx_hash: signed.hash });
  }
}

async function checkSubmitted(ctx: RecoveryCtx, c: CaseRow): Promise<void> {
  if (!c.recovery_tx_hash) return;
  const receipt = await ctx.chain.getReceipt(c.recovery_tx_hash as Hex);
  if (!receipt) return;
  if (receipt.status === 'reverted') {
    await ctx.db`UPDATE recovery_cases SET status = 'open', error = 'recovery transaction reverted', updated_at = now() WHERE id = ${c.id}`;
    return;
  }
  let amount: bigint | null = null;
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== ctx.contracts.distributor.toLowerCase()) continue;
    try {
      const ev = decodeEventLog({ abi: distributorAbi, data: log.data, topics: log.topics as [Hex, ...Hex[]] });
      if (ev.eventName === 'FundsRecovered') amount = ev.args.amount;
    } catch { /* unrelated log */ }
  }
  if (amount === null) return;
  await ctx.db`UPDATE recovery_cases SET status = 'recovered', amount_units = ${amount.toString()}, error = NULL, updated_at = now() WHERE id = ${c.id}`;
  ctx.alerts.clear(`recovery_blocked:${c.id}`);
  ctx.log.info('funds_recovered', { caseId: c.id, amount: amount.toString() });
}
