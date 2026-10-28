// arc-studio-allow-onchain-literal (test fixtures)
import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getAddress } from 'viem';
import { makeHarness, intentBody, idem, type Harness } from '../../api/src/testing';
import { expireOverdue } from '../../api/src/payments/state';
import { decodeDeposits } from './logs';
import { evaluateIntent, type EvalCtx } from './evaluate';
import { scanOnce, type ScannerCtx } from './scanner';
import { EMITTER, FakeSource, transferLog, unixOf } from './testing';
import { silentLogger } from './types';
import type { Address } from '@acqui/shared';

let h: Harness;
let apiKey: string;
beforeEach(async () => {
  h = await makeHarness();
  apiKey = (await h.onboard('scan-merchant')).apiKey;
});
afterEach(async () => { await h.close(); });

interface Created { id: string; receiver: Address; expiresSec: bigint }
async function createIntent(amount = '10.00'): Promise<Created> {
  const res = await h.call('POST', '/v1/payment-intents', { apiKey, body: intentBody({ amount, order_id: `o-${Math.random()}` }), headers: { 'idempotency-key': idem() } });
  assert.equal(res.status, 201, res.text);
  const receiver = getAddress(res.body.receiver_address as string);
  const row = (await h.db`SELECT id, expires_at FROM payment_intents WHERE receiver_address = ${receiver.toLowerCase()}`)[0];
  return { id: row?.id as string, receiver, expiresSec: unixOf(row?.expires_at as Date) };
}
const sourceAt = () => new FakeSource(100n, unixOf(h.clock.now));
const scanCtx = (source: FakeSource, over: Partial<ScannerCtx['config']> = {}): ScannerCtx => ({
  db: h.db, source, emitter: EMITTER, log: silentLogger, now: () => h.clock.now,
  config: { SCAN_MAX_BLOCKS: 100, REPLAY_OVERLAP_BLOCKS: 2, SCANNER_START_BLOCK: 100n, ...over },
});
const evalCtx = (): EvalCtx => ({ db: h.db, chainId: 5042002, recoveryDelaySeconds: 86_400n, log: silentLogger, now: () => h.clock.now });
const status = async (id: string) => (await h.db`SELECT status FROM payment_intents WHERE id = ${id}`)[0]?.status as string;
const deposits = async (id: string) => h.db`SELECT amount_units, on_time, tx_hash FROM deposits WHERE payment_intent_id = ${id} ORDER BY block_number, log_index`;

void describe('detecting native and ERC-20 USDC', () => {
  void it('counts a plain native send from the system emitter', async () => {
    const a = await createIntent();
    const s = sourceAt();
    s.nativeSend(s.headTs + 5n, a.receiver, 10_000_000n);
    const r = await scanOnce(scanCtx(s));
    assert.equal(r?.newDeposits, 1);
    assert.equal(BigInt((await deposits(a.id))[0]?.amount_units as string), 10_000_000n);
    assert.equal(await status(a.id), 'deposit_detected');
  });

  void it('counts an ERC-20 transfer once even though it emits two logs (6 and 18 decimals)', async () => {
    const a = await createIntent();
    const s = sourceAt();
    s.erc20Send(s.headTs + 5n, a.receiver, 10_000_000n);
    await scanOnce(scanCtx(s));
    const rows = await deposits(a.id);
    assert.equal(rows.length, 1);
    assert.equal(BigInt(rows[0]?.amount_units as string), 10_000_000n);
    // The decoder itself also ignores every emitter except the system emitter.
    const both = s.blocks.flatMap((b) => b.logs);
    assert.equal(both.length, 2);
    assert.equal(decodeDeposits(both, EMITTER).length, 1);
  });

  void it('ignores sub-1e-6 native dust and zero-value logs', async () => {
    const a = await createIntent();
    const s = sourceAt();
    s.nativeSend(s.headTs + 5n, a.receiver, 9_000_000n, 999_999_999_999n); // 9.000000 + <1e-6
    s.mine(s.headTs + 6n, [transferLog(EMITTER, getAddress('0x0000000000000000000000000000000000000001'), a.receiver, 5n, s.newTx(), 0)]); // pure dust
    await scanOnce(scanCtx(s));
    const rows = await deposits(a.id);
    assert.equal(rows.length, 1);
    assert.equal(BigInt(rows[0]?.amount_units as string), 9_000_000n);
  });

  void it('ignores transfers to addresses that are not registered receivers', async () => {
    await createIntent();
    const s = sourceAt();
    s.nativeSend(s.headTs + 5n, getAddress('0x00000000000000000000000000000000000bad01'), 10_000_000n);
    const r = await scanOnce(scanCtx(s));
    assert.equal(r?.matched, 0);
    assert.equal((await h.db`SELECT count(*)::int AS n FROM deposits`)[0]?.n, 0);
  });
});

void describe('cursor, replay and restart', () => {
  void it('deduplicates repeated events across overlapping scans and within one batch', async () => {
    const a = await createIntent();
    const s = sourceAt();
    const tx = s.nativeSend(s.headTs + 5n, a.receiver, 4_000_000n);
    const dup = s.blocks[s.blocks.length - 1]?.logs[0];
    if (dup) s.blocks[s.blocks.length - 1]?.logs.push({ ...dup }); // provider repeats the same log
    await scanOnce(scanCtx(s, { REPLAY_OVERLAP_BLOCKS: 50 }));
    s.idle(s.headTs + 6n, 3);
    await scanOnce(scanCtx(s, { REPLAY_OVERLAP_BLOCKS: 50 })); // overlap re-reads the deposit block
    await scanOnce(scanCtx(s, { REPLAY_OVERLAP_BLOCKS: 50 }));
    const rows = await deposits(a.id);
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.tx_hash, tx.toLowerCase());
  });

  void it('resumes from the stored cursor after a restart without skipping blocks', async () => {
    const a = await createIntent();
    const s = sourceAt();
    for (let i = 0; i < 7; i += 1) s.idle(s.headTs + BigInt(i + 1));
    const txEarly = s.nativeSend(s.headTs + 20n, a.receiver, 3_000_000n);
    for (let i = 0; i < 5; i += 1) s.idle(s.headTs + BigInt(i + 1));
    s.nativeSend(s.headTs + 30n, a.receiver, 7_000_000n);
    // process 1 scans only part of the backlog (batch of 4 blocks), then "crashes"
    await scanOnce(scanCtx(s, { SCAN_MAX_BLOCKS: 4, REPLAY_OVERLAP_BLOCKS: 0 }));
    s.calls.length = 0;
    // process 2 starts fresh with the same database
    for (let i = 0; i < 10; i += 1) {
      const r = await scanOnce(scanCtx(s, { SCAN_MAX_BLOCKS: 4, REPLAY_OVERLAP_BLOCKS: 0, SCANNER_START_BLOCK: undefined }));
      if (!r || r.scannedTo >= r.head) break;
    }
    const ranges = s.calls;
    assert.equal(ranges[0]?.[0], 104n, 'continues exactly after the committed cursor');
    for (let i = 1; i < ranges.length; i += 1) assert.equal(ranges[i]?.[0], (ranges[i - 1]?.[1] ?? 0n) + 1n, 'no gap between batches');
    const rows = await deposits(a.id);
    assert.equal(rows.length, 2);
    assert.ok(rows.some((r) => r.tx_hash === txEarly.toLowerCase()));
    assert.equal((await h.db`SELECT last_block::text AS b FROM chain_cursors`)[0]?.b, s.head.toString());
  });

  void it('does not move the cursor when processing fails, then recovers', async () => {
    const a = await createIntent();
    const s = sourceAt();
    s.nativeSend(s.headTs + 5n, a.receiver, 10_000_000n);
    s.failNext = 1;
    await assert.rejects(scanOnce(scanCtx(s)), /rpc unavailable/);
    assert.equal((await h.db`SELECT last_block::text AS b FROM chain_cursors`)[0]?.b, '99');
    await scanOnce(scanCtx(s));
    assert.equal((await deposits(a.id)).length, 1);
  });

  void it('never starts from genesis: needs an explicit start block when payments exist, starts at head when none do', async () => {
    await createIntent();
    const s = sourceAt();
    await assert.rejects(scanOnce(scanCtx(s, { SCANNER_START_BLOCK: undefined })), /SCANNER_START_BLOCK/);
    await h.db`TRUNCATE payment_intents CASCADE`;
    await scanOnce(scanCtx(s, { SCANNER_START_BLOCK: undefined }));
    assert.equal((await h.db`SELECT last_block::text AS b FROM chain_cursors`)[0]?.b, s.head.toString());
  });
});

void describe('eligibility uses the chain inclusion timestamp', () => {
  void it('accepts 29:59 and exactly 30:00, rejects 30:01', async () => {
    const early = await createIntent(); const exact = await createIntent(); const late = await createIntent();
    const s = new FakeSource(100n, early.expiresSec - 1900n);
    s.nativeSend(early.expiresSec - 1n, early.receiver, 10_000_000n); // 29:59
    s.nativeSend(exact.expiresSec, exact.receiver, 10_000_000n); // 30:00
    s.nativeSend(late.expiresSec + 1n, late.receiver, 10_000_000n); // 30:01
    s.idle(late.expiresSec + 2n);
    await scanOnce(scanCtx(s));
    assert.equal((await deposits(early.id))[0]?.on_time, true);
    assert.equal((await deposits(exact.id))[0]?.on_time, true);
    assert.equal((await deposits(late.id))[0]?.on_time, false);
    for (const i of [early, exact, late]) await evaluateIntent(evalCtx(), i.id);
    assert.equal(await status(early.id), 'verifying');
    assert.equal(await status(exact.id), 'verifying');
    assert.equal(await status(late.id), 'recovery_required', 'a late payment is never settled');
    const c = (await h.db`SELECT reason, after_settlement FROM recovery_cases WHERE payment_intent_id = ${late.id}`)[0];
    assert.equal(c?.reason, 'late');
    assert.equal(c?.after_settlement, false);
  });

  void it('uses the block timestamp, not the time the worker noticed the deposit', async () => {
    const a = await createIntent();
    const s = new FakeSource(100n, a.expiresSec - 1900n);
    s.nativeSend(a.expiresSec - 10n, a.receiver, 10_000_000n); // included on time
    h.clock.advance(3 * 3600 * 1000); // the worker only looks 3 hours later
    s.idle(a.expiresSec + 3n * 3600n);
    await scanOnce(scanCtx(s));
    await evaluateIntent(evalCtx(), a.id);
    assert.equal((await deposits(a.id))[0]?.on_time, true);
    assert.equal(await status(a.id), 'verifying');
  });

  void it('two concurrent equal-amount invoices are credited only to their own receiver', async () => {
    const a = await createIntent('10.00'); const b = await createIntent('10.00');
    const s = new FakeSource(100n, a.expiresSec - 1900n);
    s.erc20Send(a.expiresSec - 600n, a.receiver, 10_000_000n);
    s.nativeSend(a.expiresSec - 590n, getAddress('0x00000000000000000000000000000000000bad02'), 10_000_000n);
    s.idle(a.expiresSec - 500n);
    await scanOnce(scanCtx(s));
    await evaluateIntent(evalCtx(), a.id); await evaluateIntent(evalCtx(), b.id);
    assert.equal(await status(a.id), 'verifying');
    assert.equal(await status(b.id), 'awaiting_payment');
    assert.equal((await deposits(b.id)).length, 0);
  });
});

void describe('underpayment and watermark safety', () => {
  void it('becomes underpaid only after the scanner has read past the expiry, and opens a recovery case', async () => {
    const a = await createIntent();
    const s = new FakeSource(100n, a.expiresSec - 1900n);
    s.nativeSend(a.expiresSec - 900n, a.receiver, 6_000_000n);
    s.idle(a.expiresSec); // watermark == expiry: a block at 30:00 may still contain more deposits
    await scanOnce(scanCtx(s));
    await evaluateIntent(evalCtx(), a.id);
    assert.equal(await status(a.id), 'deposit_detected');
    s.idle(a.expiresSec + 1n);
    await scanOnce(scanCtx(s));
    await evaluateIntent(evalCtx(), a.id);
    assert.equal(await status(a.id), 'underpaid');
    const c = (await h.db`SELECT reason, executable_at FROM recovery_cases WHERE payment_intent_id = ${a.id}`)[0];
    assert.equal(c?.reason, 'underpaid');
    assert.equal(Math.floor((c?.executable_at as Date).getTime() / 1000), Number(a.expiresSec) + 86_400);
  });

  void it('a late top-up after an underpayment does not settle', async () => {
    const a = await createIntent();
    const s = new FakeSource(100n, a.expiresSec - 1900n);
    s.nativeSend(a.expiresSec - 900n, a.receiver, 6_000_000n);
    s.idle(a.expiresSec + 1n);
    await scanOnce(scanCtx(s));
    await evaluateIntent(evalCtx(), a.id);
    s.nativeSend(a.expiresSec + 60n, a.receiver, 4_000_000n); // completes the sum, but too late
    await scanOnce(scanCtx(s));
    await evaluateIntent(evalCtx(), a.id);
    assert.equal(await status(a.id), 'underpaid');
    assert.equal((await h.db`SELECT count(*)::int AS n FROM recovery_cases WHERE payment_intent_id = ${a.id}`)[0]?.n, 1);
  });

  void it('an on-time top-up completes a partial payment', async () => {
    const a = await createIntent();
    const s = new FakeSource(100n, a.expiresSec - 1900n);
    s.nativeSend(a.expiresSec - 900n, a.receiver, 6_000_000n);
    s.erc20Send(a.expiresSec - 100n, a.receiver, 4_000_000n);
    s.idle(a.expiresSec - 50n);
    await scanOnce(scanCtx(s));
    await evaluateIntent(evalCtx(), a.id);
    assert.equal(await status(a.id), 'verifying');
  });

  void it('never expires an unpaid intent before the scanner watermark passes its expiry', async () => {
    const a = await createIntent();
    h.clock.advance(31 * 60_000);
    assert.equal((await expireOverdue(h.db, h.clock.now, new Date((Number(a.expiresSec) - 5) * 1000))).length, 0);
    assert.equal((await expireOverdue(h.db, h.clock.now, new Date((Number(a.expiresSec) + 1) * 1000))).length, 1);
  });

  void it('late funds on an already-expired invoice become recovery_required, never settled', async () => {
    const a = await createIntent();
    h.clock.advance(31 * 60_000);
    await expireOverdue(h.db, h.clock.now, new Date((Number(a.expiresSec) + 5) * 1000));
    assert.equal(await status(a.id), 'expired');
    const s = new FakeSource(100n, a.expiresSec + 100n);
    s.nativeSend(a.expiresSec + 200n, a.receiver, 10_000_000n);
    await scanOnce(scanCtx(s));
    await evaluateIntent(evalCtx(), a.id);
    assert.equal(await status(a.id), 'recovery_required');
  });
});
