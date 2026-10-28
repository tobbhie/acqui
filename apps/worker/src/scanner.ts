import type { Address } from '@acqui/shared';
import type { Db, Q } from '../../api/src/db';
import { recordDeposit } from '../../api/src/payments/state';
import { decodeDeposits } from './logs';
import type { ChainSource, Logger } from './types';

export const DEPOSIT_STREAM = 'deposits';

export interface ScannerConfig {
  SCAN_MAX_BLOCKS: number;
  REPLAY_OVERLAP_BLOCKS: number;
  SCANNER_START_BLOCK?: bigint | undefined;
}

export interface ScannerCtx {
  db: Db;
  source: ChainSource;
  config: ScannerConfig;
  emitter: Address;
  log: Logger;
  now: () => Date;
}

export interface ScanResult {
  head: bigint;
  scannedFrom: bigint;
  scannedTo: bigint;
  logs: number;
  matched: number;
  newDeposits: number;
  touchedIntents: string[];
}

export interface CursorRow {
  last_block: string;
  last_block_timestamp: Date | null;
  head_block: string | null;
  head_seen_at: Date | null;
}

export async function loadCursor(q: Q, chainId: number): Promise<CursorRow | null> {
  const rows = await q<CursorRow[]>`
    SELECT last_block, last_block_timestamp, head_block, head_seen_at FROM chain_cursors
    WHERE chain_id = ${chainId} AND name = ${DEPOSIT_STREAM}`;
  return rows[0] ?? null;
}

/** The timestamp up to which every block has been scanned. Expiry decisions are only valid below it. */
export async function loadWatermark(q: Q, chainId: number): Promise<Date | null> {
  return (await loadCursor(q, chainId))?.last_block_timestamp ?? null;
}

async function initCursor(ctx: ScannerCtx, head: bigint): Promise<bigint> {
  const { db, source, config } = ctx;
  const existing = await db<{ n: string }[]>`SELECT count(*) AS n FROM payment_intents WHERE chain_id = ${source.chainId}`;
  const hasIntents = Number(existing[0]?.n ?? 0) > 0;
  // Never scan from genesis. A first run with live payments needs an explicit, deliberate start block.
  if (hasIntents && config.SCANNER_START_BLOCK === undefined) {
    throw new Error('No scanner cursor but payment intents exist: set SCANNER_START_BLOCK to a block before the oldest unsettled payment');
  }
  const start = config.SCANNER_START_BLOCK ?? head + 1n;
  const last = start > 0n ? start - 1n : 0n;
  await db`
    INSERT INTO chain_cursors (chain_id, name, last_block) VALUES (${source.chainId}, ${DEPOSIT_STREAM}, ${last.toString()})
    ON CONFLICT (chain_id, name) DO NOTHING`;
  ctx.log.info('scanner_cursor_initialized', { chainId: source.chainId, startBlock: start.toString(), head: head.toString() });
  return last;
}

/**
 * One incremental pass of the single global scanner. Reads system-emitter Transfer logs for a block range
 * (with a small replay overlap), keeps only transfers to registered receiver addresses (expired ones included, so
 * late funds are still identified), and commits deposits and the cursor in one transaction.
 */
export async function scanOnce(ctx: ScannerCtx): Promise<ScanResult | null> {
  const { db, source, config } = ctx;
  const head = await source.getHead();
  let cursor = await loadCursor(db, source.chainId);
  const last = cursor ? BigInt(cursor.last_block) : await initCursor(ctx, head);
  cursor = cursor ?? (await loadCursor(db, source.chainId));

  const newFrom = last + 1n;
  if (head < newFrom) {
    await db`UPDATE chain_cursors SET head_block = ${head.toString()}, head_seen_at = ${ctx.now()}
             WHERE chain_id = ${source.chainId} AND name = ${DEPOSIT_STREAM}`;
    return null;
  }
  const to = head < newFrom + BigInt(config.SCAN_MAX_BLOCKS) - 1n ? head : newFrom + BigInt(config.SCAN_MAX_BLOCKS) - 1n;
  const overlap = BigInt(config.REPLAY_OVERLAP_BLOCKS);
  const from = newFrom > overlap ? newFrom - overlap : 0n;

  const logs = await source.getTransferLogs(from, to);
  const deposits = decodeDeposits(logs, ctx.emitter);
  const recipients = [...new Set(deposits.map((d) => d.to.toLowerCase()))];
  const intents = recipients.length === 0 ? [] : await db<{ id: string; receiver_address: string; expires_at: Date }[]>`
    SELECT id, receiver_address, expires_at FROM payment_intents
    WHERE chain_id = ${source.chainId} AND receiver_address = ANY(${recipients}::text[])`;
  const byReceiver = new Map(intents.map((i) => [i.receiver_address, i]));
  const matched = deposits.filter((d) => byReceiver.has(d.to.toLowerCase()));

  const timestamps = new Map<bigint, bigint>();
  const tsOf = async (n: bigint) => {
    const known = timestamps.get(n);
    if (known !== undefined) return known;
    const ts = await source.getBlockTimestamp(n);
    timestamps.set(n, ts);
    return ts;
  };
  for (const d of matched) await tsOf(d.blockNumber);
  const watermarkTs = await tsOf(to);

  const touched = new Set<string>();
  let newDeposits = 0;
  await db.begin(async (tx) => {
    for (const d of matched) {
      const intent = byReceiver.get(d.to.toLowerCase());
      const ts = timestamps.get(d.blockNumber);
      if (!intent || ts === undefined) continue;
      // Eligibility uses the block's inclusion timestamp, never the time the worker noticed the deposit.
      const onTime = ts <= BigInt(Math.floor(intent.expires_at.getTime() / 1000));
      const inserted = await recordDeposit(tx, {
        paymentIntentId: intent.id, chainId: source.chainId, txHash: d.txHash, logIndex: d.logIndex,
        blockNumber: d.blockNumber, blockTimestamp: new Date(Number(ts) * 1000), fromAddress: d.from,
        amountUnits: d.amountUnits, onTime,
      });
      if (inserted) {
        newDeposits += 1;
        touched.add(intent.id);
      }
    }
    await tx`
      UPDATE chain_cursors SET last_block = GREATEST(last_block, ${to.toString()}),
        last_block_timestamp = ${new Date(Number(watermarkTs) * 1000)},
        head_block = ${head.toString()}, head_seen_at = ${ctx.now()}, updated_at = now()
      WHERE chain_id = ${source.chainId} AND name = ${DEPOSIT_STREAM}`;
  });

  if (newDeposits > 0) ctx.log.info('deposits_recorded', { count: newDeposits, from: from.toString(), to: to.toString() });
  return {
    head, scannedFrom: from, scannedTo: to, logs: logs.length, matched: matched.length,
    newDeposits, touchedIntents: [...touched],
  };
}
