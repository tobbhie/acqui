// arc-studio-allow-onchain-literal (test fixtures)
import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getAddress, recoverTypedDataAddress, type Hex } from 'viem';
import { hashTerms, settlementTypedData, DISTRIBUTOR_EIP712_NAME } from '@acqui/shared';
import { makeHarness, intentBody, idem, DISTRIBUTOR, type Harness, type Session } from '../../api/src/testing';
import { recordDeposit } from '../../api/src/payments/state';
import { evaluateIntent, type EvalCtx } from './evaluate';
import { keeperTick, processPayment, termsOf, type IntentRow } from './keeper';
import { recoveryTick, type RecoveryCtx } from './recovery';
import { attesterAccount, FakeKeeper, keeperCtx, recoveredReceipt, settleReceipt, unixOf } from './testing';
import { silentLogger } from './types';

let h: Harness;
let session: Session;
let apiKey: string;
let chain: FakeKeeper;
let ctx: ReturnType<typeof keeperCtx>;
const evalCtx = (): EvalCtx => ({ db: h.db, chainId: 5042002, recoveryDelaySeconds: 86_400n, log: silentLogger, now: () => h.clock.now });

beforeEach(async () => {
  h = await makeHarness();
  const m = await h.onboard('keeper-merchant');
  session = m.session; apiKey = m.apiKey;
  await h.call('PATCH', '/v1/merchant', { session, body: { webhook_url: 'https://hooks.example.com/acqui' } });
  chain = new FakeKeeper();
  chain.headTimestamp = unixOf(h.clock.now);
  ctx = keeperCtx(h, chain);
});
afterEach(async () => { await h.close(); });

async function newIntent(amount = '10.00'): Promise<IntentRow> {
  const res = await h.call('POST', '/v1/payment-intents', { apiKey, body: intentBody({ amount, order_id: `o-${Math.random()}` }), headers: { 'idempotency-key': idem() } });
  assert.equal(res.status, 201, res.text);
  return (await h.db<IntentRow[]>`SELECT * FROM payment_intents WHERE receiver_address = ${(res.body.receiver_address as string).toLowerCase()}`)[0];
}
let seq = 0;
async function deposit(i: IntentRow, units: bigint, onTime = true, offsetSec = -60): Promise<Hex> {
  seq += 1;
  const tx: Hex = `0x${seq.toString(16).padStart(64, '0')}`;
  const ts = new Date(i.expires_at.getTime() + offsetSec * 1000);
  await recordDeposit(h.db, { paymentIntentId: i.id, chainId: 5042002, txHash: tx, logIndex: 1, blockNumber: BigInt(1000 + seq), blockTimestamp: ts, fromAddress: null, amountUnits: units, onTime });
  chain.usdc.set(i.receiver_address.toLowerCase(), (chain.usdc.get(i.receiver_address.toLowerCase()) ?? 0n) + units);
  return tx;
}
async function toVerifying(amount = '10.00', units = 10_000_000n): Promise<IntentRow> {
  const i = await newIntent(amount);
  await deposit(i, units);
  await evaluateIntent(evalCtx(), i.id);
  return (await row(i.id));
}
const row = async (id: string) => (await h.db<IntentRow[]>`SELECT * FROM payment_intents WHERE id = ${id}`)[0];
const status = async (id: string) => (await row(id)).status;
const attempts = (id: string) => h.db`SELECT attempt_no, status, tx_hash, raw_tx, error_code, signature FROM settlement_attempts WHERE payment_intent_id = ${id} ORDER BY attempt_no`;
/** Mines a receipt for whatever transaction the keeper broadcasts. */
const mineWith = (i: IntentRow, make: () => ReturnType<typeof settleReceipt>) => { chain.onBroadcast = (_raw, hash) => chain.receipts.set(hash.toLowerCase(), make()); };

void describe('settlement keeper', () => {
  void it('verifies the deposit, signs a bounded attestation, pays out and only then marks settled', async () => {
    const i = await toVerifying();
    mineWith(i, () => settleReceipt(i));
    await keeperTick(ctx); // verifying -> settling with a signed attestation
    assert.equal(await status(i.id), 'settling');
    const att = (await h.db`SELECT evidence, signature FROM settlement_attempts WHERE payment_intent_id = ${i.id}`)[0];
    const ev = att?.evidence as { eligibleAmount: string; depositTimestamp: string; evidenceTxHash: Hex; evidenceBlock: string };
    const typed = settlementTypedData({ chainId: 5042002n, verifyingContract: DISTRIBUTOR }, hashTerms(5042002n, termsOf(i)), {
      eligibleAmount: BigInt(ev.eligibleAmount), depositTimestamp: BigInt(ev.depositTimestamp), evidenceTxHash: ev.evidenceTxHash, evidenceBlock: BigInt(ev.evidenceBlock) });
    assert.equal(typed.domain.name, DISTRIBUTOR_EIP712_NAME);
    assert.equal(await recoverTypedDataAddress({ ...typed, signature: att?.signature as Hex }), attesterAccount.address, 'signed by the attester key');
    assert.equal(ev.eligibleAmount, '10000000');
    assert.equal(chain.broadcasts.length, 0, 'nothing is sent before the attempt exists');

    await keeperTick(ctx); // settling -> broadcast -> receipt -> settled
    const after = await row(i.id);
    assert.equal(after.status, 'settled');
    assert.equal(chain.broadcasts.length, 1);
    const a = await attempts(i.id);
    assert.equal(a[0]?.status, 'confirmed');
    assert.equal((await h.db`SELECT settlement_tx_hash FROM payment_intents WHERE id = ${i.id}`)[0]?.settlement_tx_hash, a[0]?.tx_hash);
    const hook = (await h.db`SELECT event_type, status FROM webhook_deliveries WHERE payment_intent_id = ${i.id}`)[0];
    assert.deepEqual({ ...hook }, { event_type: 'payment.settled', status: 'pending' });
  });

  void it('persists the signed transaction before broadcasting and re-sends the same bytes after a failure', async () => {
    const i = await toVerifying();
    mineWith(i, () => settleReceipt(i));
    await keeperTick(ctx);
    chain.broadcastError = new Error('network down');
    await keeperTick(ctx); // crashes at broadcast
    const stored = (await attempts(i.id))[0];
    assert.equal(stored?.status, 'submitted');
    assert.ok(stored?.raw_tx, 'raw transaction saved before the broadcast attempt');
    chain.broadcastError = null;
    h.clock.advance(30_000);
    await keeperTick(ctx); // re-broadcasts the stored bytes
    await keeperTick(ctx); // sees the receipt
    assert.equal(chain.broadcasts.length, 1);
    assert.equal(chain.broadcasts[0], stored?.raw_tx, 'exactly the stored transaction, never a new one');
    assert.equal(await status(i.id), 'settled');
  });

  void it('after a crash, finds the payout already on chain and settles without sending anything', async () => {
    const i = await toVerifying();
    await keeperTick(ctx);
    const tx: Hex = `0x${'ab'.repeat(32)}`;
    chain.settled.add(i.receiver_address.toLowerCase());
    chain.settledLogs.set(i.receiver_address.toLowerCase(), { address: DISTRIBUTOR, blockNumber: 500n, logIndex: 3, transactionHash: tx, topics: [], data: '0x' });
    chain.receipts.set(tx, settleReceipt(i));
    await keeperTick(ctx);
    assert.equal(await status(i.id), 'settled');
    assert.equal(chain.broadcasts.length, 0, 'no second payout, no gas spent');
    assert.equal((await h.db`SELECT settlement_tx_hash FROM payment_intents WHERE id = ${i.id}`)[0]?.settlement_tx_hash, tx);
  });

  void it('a reverted settlement is not settled; it retries with backoff and then succeeds', async () => {
    const i = await toVerifying();
    let revert = true;
    mineWith(i, () => settleReceipt(i, { status: revert ? 'reverted' : 'success' }));
    await keeperTick(ctx); await keeperTick(ctx);
    assert.equal(await status(i.id), 'retryable_failure');
    assert.equal((await attempts(i.id))[0]?.error_code, 'reverted');
    assert.ok(ctx.alertsRaised.some((c) => c.startsWith('settlement_reverted')));
    await keeperTick(ctx); // backoff not over yet
    assert.equal(await status(i.id), 'retryable_failure');
    revert = false;
    h.clock.advance(20_000);
    await keeperTick(ctx); await keeperTick(ctx);
    assert.equal(await status(i.id), 'settled');
    const a = await attempts(i.id);
    assert.deepEqual(a.map((x) => x.status as string), ['failed', 'confirmed']);
  });

  void it('gives up after five failed attempts and hands the money to recovery', async () => {
    const i = await toVerifying();
    mineWith(i, () => settleReceipt(i, { status: 'reverted' }));
    for (let n = 0; n < 5; n += 1) {
      await keeperTick(ctx); await keeperTick(ctx);
      h.clock.advance(11 * 60_000);
    }
    await keeperTick(ctx);
    assert.equal(await status(i.id), 'recovery_required');
    assert.equal((await h.db`SELECT reason FROM recovery_cases WHERE payment_intent_id = ${i.id}`)[0]?.reason, 'settlement_failed');
    assert.equal((await attempts(i.id)).length, 5);
  });

  void it('does not spend gas when the simulation already reverts', async () => {
    const i = await toVerifying();
    await keeperTick(ctx);
    chain.simQueue.push({ ok: false, error: 'InsufficientReceiverBalance', detail: 'simulated' });
    await keeperTick(ctx);
    assert.equal(chain.broadcasts.length, 0);
    assert.equal(await status(i.id), 'retryable_failure');
    assert.equal((await attempts(i.id))[0]?.error_code, 'InsufficientReceiverBalance');
  });

  void it('waits and alerts on a gas shortage, then settles once the keeper is funded', async () => {
    const i = await toVerifying();
    mineWith(i, () => settleReceipt(i));
    await keeperTick(ctx);
    chain.balanceWei = 0n;
    await keeperTick(ctx);
    assert.equal(chain.broadcasts.length, 0);
    assert.equal(await status(i.id), 'settling');
    assert.equal((await attempts(i.id))[0]?.error_code, 'insufficient_gas');
    assert.ok(ctx.alertsRaised.includes('keeper_gas_shortage'));
    chain.balanceWei = 10n ** 18n;
    await keeperTick(ctx);
    assert.equal(await status(i.id), 'settled');
  });

  void it('never double-settles: repeated and concurrent passes send exactly one transaction', async () => {
    const i = await toVerifying();
    mineWith(i, () => settleReceipt(i));
    await keeperTick(ctx);
    await Promise.allSettled([processPayment(ctx, i.id), processPayment(ctx, i.id)]); // the loser fails on a compare-and-set, never on a second payout
    await keeperTick(ctx); await keeperTick(ctx);
    assert.equal(chain.broadcasts.length, 1);
    assert.equal(await status(i.id), 'settled');
    assert.equal((await h.db`SELECT count(*)::int AS n FROM settlement_attempts WHERE payment_intent_id = ${i.id} AND status = 'confirmed'`)[0]?.n, 1);
    assert.equal((await h.db`SELECT count(*)::int AS n FROM webhook_deliveries WHERE payment_intent_id = ${i.id}`)[0]?.n, 1);
  });

  void it('the database refuses a second live attempt for the same payment', async () => {
    const i = await toVerifying();
    await keeperTick(ctx);
    await assert.rejects(h.db`INSERT INTO settlement_attempts (payment_intent_id, attempt_no, chain_id) VALUES (${i.id}, 2, 5042002)`);
  });

  void it('a receipt that disagrees with the snapshot, or lacks the payout leg, never marks settled', async () => {
    const i = await toVerifying();
    mineWith(i, () => settleReceipt(i, { net: BigInt(i.merchant_net_units) + 1n }));
    await keeperTick(ctx); await keeperTick(ctx);
    assert.equal(await status(i.id), 'settling');
    assert.equal((await h.db`SELECT count(*)::int AS n FROM webhook_deliveries`)[0]?.n, 0);

    const j = await toVerifying();
    mineWith(j, () => settleReceipt(j, { omitPayout: true }));
    await keeperTick(ctx); await keeperTick(ctx);
    assert.notEqual(await status(j.id), 'settled');
    assert.ok(ctx.alertsRaised.some((c) => c.startsWith('payout_leg_missing')));
  });

  void it('refuses to sign when the stored terms no longer reproduce the committed receiver', async () => {
    const i = await toVerifying();
    await h.db`UPDATE payment_intents SET distributor_address = '0x00000000000000000000000000000000000000ff' WHERE id = ${i.id}`;
    await keeperTick(ctx);
    assert.equal(await status(i.id), 'verifying');
    assert.equal((await attempts(i.id)).length, 0);
    assert.ok(ctx.alertsRaised.includes('terms_integrity_failure'));
  });

  void it('does not sign when a recorded deposit cannot be re-verified on chain or the receiver is short', async () => {
    const i = await toVerifying();
    chain.verifyOk = false;
    await keeperTick(ctx);
    assert.equal((await attempts(i.id)).length, 0);
    chain.verifyOk = true;
    chain.usdc.set(i.receiver_address.toLowerCase(), 1n);
    await keeperTick(ctx);
    assert.equal((await attempts(i.id)).length, 0);
    assert.equal(await status(i.id), 'verifying');
  });

  void it('abandons settlement once the contract window is closed and never signs', async () => {
    const i = await toVerifying();
    chain.headTimestamp = unixOf(i.expires_at) + 86_401n;
    await keeperTick(ctx);
    assert.equal(await status(i.id), 'recovery_required');
    assert.equal((await attempts(i.id)).length, 0);
  });
});

void describe('recovery executor', () => {
  const recCtx = (): RecoveryCtx => ({
    db: h.db, chain, contracts: { chainId: 5042002, distributor: DISTRIBUTOR }, autoExecute: true, minBalanceWei: 0n,
    alerts: ctx.alerts, log: silentLogger, now: () => h.clock.now, sleep: () => Promise.resolve(),
  });

  void it('returns an overpayment right after settlement', async () => {
    const i = await toVerifying('10.00', 10_000_000n);
    await deposit(i, 2_000_000n);
    mineWith(i, () => settleReceipt(i));
    await keeperTick(ctx); await keeperTick(ctx);
    assert.equal(await status(i.id), 'settled');
    await evaluateIntent(evalCtx(), i.id);
    const c = (await h.db`SELECT reason, after_settlement FROM recovery_cases WHERE payment_intent_id = ${i.id}`)[0];
    assert.deepEqual({ ...c }, { reason: 'overpaid', after_settlement: true });
    chain.onBroadcast = (_raw, hash) => chain.receipts.set(hash.toLowerCase(), recoveredReceipt(i, 2_000_000n));
    await recoveryTick(recCtx());
    const done = (await h.db`SELECT status, amount_units::text AS amount FROM recovery_cases WHERE payment_intent_id = ${i.id}`)[0];
    assert.deepEqual({ ...done }, { status: 'recovered', amount: '2000000' });
  });

  void it('waits for the contract grace period (chain time) before refunding an underpayment', async () => {
    const i = await newIntent();
    await deposit(i, 6_000_000n);
    await evaluateIntent(evalCtx(), i.id);
    await h.db`INSERT INTO chain_cursors (chain_id, name, last_block, last_block_timestamp) VALUES (5042002, 'deposits', 1, ${new Date(i.expires_at.getTime() + 5000)})
               ON CONFLICT (chain_id, name) DO UPDATE SET last_block_timestamp = EXCLUDED.last_block_timestamp`;
    await evaluateIntent(evalCtx(), i.id);
    assert.equal(await status(i.id), 'underpaid');
    chain.headTimestamp = unixOf(i.expires_at) + 3600n;
    await recoveryTick(recCtx());
    assert.equal(chain.broadcasts.length, 0, 'still inside the grace window');
    assert.equal(await status(i.id), 'underpaid');
    chain.headTimestamp = unixOf(i.expires_at) + 86_400n;
    chain.onBroadcast = (_raw, hash) => chain.receipts.set(hash.toLowerCase(), recoveredReceipt(i, 6_000_000n));
    await recoveryTick(recCtx());
    assert.equal(chain.broadcasts.length, 1);
    assert.equal(await status(i.id), 'recovery_required');
    assert.equal((await h.db`SELECT status FROM recovery_cases WHERE payment_intent_id = ${i.id}`)[0]?.status, 'recovered');
  });

  void it('closes a case when the contract reports nothing left to recover', async () => {
    const i = await toVerifying();
    mineWith(i, () => settleReceipt(i));
    await keeperTick(ctx); await keeperTick(ctx);
    await h.db`UPDATE payment_intents SET status = status WHERE id = ${i.id}`;
    await h.db`INSERT INTO recovery_cases (payment_intent_id, merchant_id, reason, refund_address, after_settlement, executable_at)
               SELECT id, merchant_id, 'overpaid', refund_address, true, now() FROM payment_intents WHERE id = ${i.id}`;
    chain.simQueue.push({ ok: false, error: 'NothingToRecover', detail: '' });
    await recoveryTick(recCtx());
    assert.equal((await h.db`SELECT status FROM recovery_cases WHERE payment_intent_id = ${i.id}`)[0]?.status, 'closed');
  });
});

void it('keeps the helper used', () => { assert.equal(getAddress(chain.keeperAddress), chain.keeperAddress); });
