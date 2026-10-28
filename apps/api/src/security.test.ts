// arc-studio-allow-onchain-literal
import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_LIMITS } from './app';
import { decryptSecret, encryptSecret } from './lib/crypto';
import { FixedWindowLimiter } from './lib/rate-limit';
import { unitsToDecimal } from './lib/units';
import { parseReturnUrl, parseWebhookUrl } from './lib/urls';
import { StateTransitionError, markSettled, recordDeposit, transition } from './payments/state';
import { idem, intentBody, makeHarness, MERCHANT_ADDRESS, type Harness } from './testing';

let h: Harness;
void before(async () => { h = await makeHarness(); });
void beforeEach(async () => {
  await h.db.unsafe('TRUNCATE users, merchants, sessions, oauth_flows, api_keys, webhook_secrets, payment_intents, payment_status_events, deposits, payout_address_changes CASCADE');
  h.mails.length = 0;
});
void after(async () => { await h.close(); });

const create = (apiKey: string) => h.call('POST', '/v1/payment-intents', { apiKey, body: intentBody(), headers: { 'idempotency-key': idem() } });

void describe('API keys', () => {
  void it('issues an aq_live_ secret once and stores only a keyed digest', async () => {
    const { session } = await h.onboard('k1');
    const res = await h.call('POST', '/v1/merchant/api-keys', { session, body: { label: 'prod' } });
    const secret = res.body.secret as string;
    assert.match(secret, /^aq_live_[0-9a-f]{16}_[A-Za-z0-9_-]{43}$/);
    const secretPart = secret.split('_')[3] ?? '';
    assert.ok(!JSON.stringify(await h.db`SELECT * FROM api_keys`).includes(secretPart));
    const list = await h.call('GET', '/v1/merchant/api-keys', { session });
    assert.ok(!list.text.includes(secretPart));
    assert.match((list.body.data as { prefix: string }[])[0]?.prefix ?? '', /^aq_live_[0-9a-f]{16}$/);
  });

  void it('authenticates with the bearer key, rejects malformed, wrong and unknown keys', async () => {
    const { apiKey } = await h.onboard('k2');
    assert.equal((await h.call('GET', '/v1/payments', { apiKey })).status, 200);
    const tampered = `${apiKey.slice(0, -2)}AA`;
    assert.equal((await h.call('GET', '/v1/payments', { apiKey: tampered })).status, 401);
    assert.equal((await h.call('GET', '/v1/payments', { apiKey: 'aq_live_0000000000000000_' + 'A'.repeat(43) })).status, 401);
    assert.equal((await h.call('GET', '/v1/payments', { apiKey: 'garbage' })).status, 401);
    assert.equal((await h.call('GET', '/v1/payments')).status, 401);
  });

  void it('revocation takes effect immediately and is permanent', async () => {
    const { session, apiKey } = await h.onboard('k3');
    const keyId = ((await h.call('GET', '/v1/merchant/api-keys', { session })).body.data as { id: string }[])[0]?.id ?? '';
    assert.equal((await create(apiKey)).status, 201);
    assert.equal((await h.call('DELETE', `/v1/merchant/api-keys/${keyId}`, { session })).status, 204);
    assert.equal((await create(apiKey)).status, 401);
    assert.equal((await h.call('GET', '/v1/payment-intents/pi_' + '0'.repeat(32), { apiKey })).status, 401);
  });

  void it('rotation issues a new key and revokes the old one, optionally after a grace window', async () => {
    const { session, apiKey } = await h.onboard('k4');
    const keyId = ((await h.call('GET', '/v1/merchant/api-keys', { session })).body.data as { id: string }[])[0]?.id ?? '';
    const rotated = await h.call('POST', `/v1/merchant/api-keys/${keyId}/rotate`, { session, body: {} });
    assert.equal(rotated.status, 201);
    assert.equal((await create(apiKey)).status, 401);
    assert.equal((await create(rotated.body.secret as string)).status, 201);

    const newId = rotated.body.id as string;
    const graceful = await h.call('POST', `/v1/merchant/api-keys/${newId}/rotate`, { session, body: { grace_seconds: 600 } });
    assert.equal((await create(rotated.body.secret as string)).status, 201);
    h.clock.advance(601_000);
    assert.equal((await create(rotated.body.secret as string)).status, 401);
    assert.equal((await create(graceful.body.secret as string)).status, 201);
  });

  void it('keys cannot manage keys, payouts, webhooks or settings', async () => {
    const { apiKey } = await h.onboard('k5');
    for (const [method, path] of [['GET', '/v1/merchant'], ['POST', '/v1/merchant/api-keys'], ['POST', '/v1/merchant/webhook-secret'], ['POST', '/v1/merchant/payout-address/change']] as const) {
      const res = await h.call(method, path, { apiKey, body: {} });
      assert.equal(res.status, 401, `${method} ${path}`);
    }
  });

  void it('caps the number of active keys', async () => {
    const { session } = await h.onboard('k6');
    for (let i = 0; i < 9; i += 1) assert.equal((await h.call('POST', '/v1/merchant/api-keys', { session, body: { label: `k${i}` } })).status, 201);
    assert.equal((await h.call('POST', '/v1/merchant/api-keys', { session, body: { label: 'one-too-many' } })).status, 409);
  });
});

void describe('tenant isolation', () => {
  void it('a merchant cannot read, list or guess another merchant payments', async () => {
    const a = await h.onboard('tenant-a');
    const b = await h.onboard('tenant-b');
    const made = await create(a.apiKey);
    const id = made.body.payment_id as string;
    assert.equal((await h.call('GET', `/v1/payment-intents/${id}`, { apiKey: a.apiKey })).status, 200);
    assert.equal((await h.call('GET', `/v1/payment-intents/${id}`, { apiKey: b.apiKey })).status, 404);
    assert.equal(((await h.call('GET', '/v1/payments', { apiKey: b.apiKey })).body.data as unknown[]).length, 0);
    assert.equal(((await h.call('GET', '/v1/payments', { apiKey: a.apiKey })).body.data as unknown[]).length, 1);
    assert.equal((await h.call('GET', `/v1/payment-intents/${id}`, { session: b.session })).status, 404);
  });

  void it('a body cannot select another merchant', async () => {
    const a = await h.onboard('iso-a');
    const b = await h.onboard('iso-b');
    const res = await h.call('POST', '/v1/payment-intents', { apiKey: a.apiKey, body: intentBody({ merchant_id: b.merchantId }), headers: { 'idempotency-key': idem() } });
    assert.equal(res.status, 422);
    const ok = await create(a.apiKey);
    assert.equal((await h.db`SELECT merchant_id FROM payment_intents WHERE public_id = ${ok.body.public_id as string}`)[0]?.merchant_id, a.merchantId);
  });
});

void describe('state machine and duplicate events', () => {
  const newIntent = async () => {
    const { apiKey } = await h.onboard(`sm-${Math.random().toString(36).slice(2, 8)}`);
    const made = await create(apiKey);
    const row = (await h.db`SELECT id, receiver_address FROM payment_intents WHERE public_id = ${made.body.public_id as string}`)[0];
    return { id: row?.id as string, receiver: row?.receiver_address as string };
  };
  const dep = (id: string, over: Record<string, unknown> = {}) => ({
    paymentIntentId: id, chainId: 5042002, txHash: `0x${'cd'.repeat(32)}`, logIndex: 3, blockNumber: 10n,
    blockTimestamp: h.clock.now, fromAddress: null, amountUnits: 10_000_000n, onTime: true, ...over,
  });

  void it('records a chain event once and moves to deposit_detected once', async () => {
    const { id } = await newIntent();
    assert.equal(await recordDeposit(h.db, dep(id)), true);
    assert.equal(await recordDeposit(h.db, dep(id)), false);
    assert.equal((await h.db`SELECT 1 FROM deposits`).length, 1);
    assert.equal((await h.db`SELECT status FROM payment_intents WHERE id = ${id}`)[0]?.status, 'deposit_detected');
    assert.equal(await recordDeposit(h.db, dep(id, { logIndex: 4 })), true);
    assert.equal((await h.db`SELECT 1 FROM payment_status_events WHERE to_status = 'deposit_detected'`).length, 1);
  });

  void it('rejects illegal and stale transitions', async () => {
    const { id } = await newIntent();
    await assert.rejects(transition(h.db, id, 'awaiting_payment', 'settling', 'x'), StateTransitionError);
    await assert.rejects(transition(h.db, id, 'deposit_detected', 'verifying', 'x'), /no longer/);
    await transition(h.db, id, 'awaiting_payment', 'deposit_detected', 'ok');
    await assert.rejects(transition(h.db, id, 'awaiting_payment', 'deposit_detected', 'again'), /no longer/);
  });

  void it('can never reach settled without a confirmed payout receipt', async () => {
    const { id } = await newIntent();
    await assert.rejects(transition(h.db, id, 'settling', 'settled', 'x'), /markSettled/);
    await assert.rejects(h.db`UPDATE payment_intents SET status = 'settled' WHERE id = ${id}`, /settled_needs_receipt/);

    await transition(h.db, id, 'awaiting_payment', 'deposit_detected', 'd');
    await transition(h.db, id, 'deposit_detected', 'verifying', 'v');
    await transition(h.db, id, 'verifying', 'settling', 's');
    const receipt = { txHash: `0x${'ee'.repeat(32)}`, logIndex: 1, blockNumber: 12n, gross: 10_000_000n, fee: 100_000n, keeperReimbursement: 20_000n, merchantNet: 9_880_000n, merchant: MERCHANT_ADDRESS };
    await assert.rejects(markSettled(h.db, id, { ...receipt, merchantNet: 9_990_000n }, h.clock.now), /does not match/);
    await assert.rejects(markSettled(h.db, id, { ...receipt, merchant: '0x9999999999999999999999999999999999999999' }, h.clock.now), /does not match/);
    assert.equal((await h.db`SELECT status FROM payment_intents WHERE id = ${id}`)[0]?.status, 'settling');
    await markSettled(h.db, id, receipt, h.clock.now);
    const row = (await h.db`SELECT status, settlement_tx_hash FROM payment_intents WHERE id = ${id}`)[0];
    assert.equal(row?.status, 'settled');
    assert.equal(row?.settlement_tx_hash, receipt.txHash);
    await assert.rejects(markSettled(h.db, id, receipt, h.clock.now), /not settling/);
  });

  void it('enforces unique receivers and amount conservation in the schema', async () => {
    const { id, receiver } = await newIntent();
    await assert.rejects(h.db`UPDATE payment_intents SET merchant_net_units = merchant_net_units + 1 WHERE id = ${id}`, /immutable|amounts/);
    assert.ok(receiver.startsWith('0x'));
    assert.equal((await h.db`SELECT count(DISTINCT receiver_address) AS n FROM payment_intents`)[0]?.n, '1');
  });
});

void describe('rate limiting', () => {
  void it('limits a key and sends Retry-After', async () => {
    const limited = await makeHarness({ limits: { ...DEFAULT_LIMITS, perKeyPerMinute: 3, perIpPerMinute: 1000 } });
    try {
      const { apiKey } = await limited.onboard('rl');
      const codes: number[] = [];
      for (let i = 0; i < 5; i += 1) codes.push((await limited.call('GET', '/v1/payments', { apiKey })).status);
      assert.deepEqual(codes, [200, 200, 200, 429, 429]);
      const blocked = await limited.call('GET', '/v1/payments', { apiKey });
      assert.ok(Number(blocked.headers.get('retry-after')) >= 1);
      limited.clock.advance(61_000);
      assert.equal((await limited.call('GET', '/v1/payments', { apiKey })).status, 200);
    } finally {
      await limited.close();
    }
  });

  void it('fixed-window limiter resets after the window', () => {
    let now = 0;
    const limiter = new FixedWindowLimiter(2, 1000, () => now);
    assert.deepEqual([limiter.hit('a').allowed, limiter.hit('a').allowed, limiter.hit('a').allowed], [true, true, false]);
    assert.equal(limiter.hit('b').allowed, true);
    now = 1001;
    assert.equal(limiter.hit('a').allowed, true);
  });
});

void describe('helpers', () => {
  void it('formats units without floats', () => {
    assert.equal(unitsToDecimal(10_000_000n), '10.00');
    assert.equal(unitsToDecimal(9_880_000n), '9.88');
    assert.equal(unitsToDecimal(1n), '0.000001');
    assert.equal(unitsToDecimal(123_456_789_000_000n), '123456789.00');
  });

  void it('encrypts and authenticates webhook secrets', () => {
    const key = 'cd'.repeat(32);
    const { ciphertext, nonce } = encryptSecret(key, 'whsec_abc');
    assert.equal(decryptSecret(key, ciphertext, nonce), 'whsec_abc');
    const tampered = Buffer.from(ciphertext);
    tampered[0] = (tampered[0] ?? 0) ^ 1;
    assert.throws(() => decryptSecret(key, tampered, nonce));
    assert.throws(() => decryptSecret('ef'.repeat(32), ciphertext, nonce));
  });

  void it('URL validators', () => {
    assert.equal(parseReturnUrl('https://a.example/x?y=1', 'https://a.example', 'u', true), 'https://a.example/x?y=1');
    assert.throws(() => parseReturnUrl('https://b.example/x', 'https://a.example', 'u', true));
    assert.throws(() => parseReturnUrl('http://localhost:3000/x', 'http://localhost:3000', 'u', true), /https/);
    assert.equal(parseReturnUrl('http://localhost:3000/x', 'http://localhost:3000', 'u', false), 'http://localhost:3000/x');
    assert.throws(() => parseWebhookUrl('https://172.16.0.1/x', true));
    assert.throws(() => parseWebhookUrl('https://100.64.0.1/x', true));
    assert.equal(parseWebhookUrl('https://hooks.example.com/x', true), 'https://hooks.example.com/x');
  });
});
