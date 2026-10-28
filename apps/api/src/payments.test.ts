// arc-studio-allow-onchain-literal
import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { deriveReceiverAddress, type Hex } from '@acqui/shared';
import { expireOverdue } from './payments/state';
import { CUSTOMER_ADDRESS, DISTRIBUTOR, idem, intentBody, makeHarness, MERCHANT_ADDRESS, OTHER_ADDRESS, testContracts, type Harness } from './testing';

let h: Harness;
let acct: { session: { cookie: string; csrf: string }; apiKey: string; merchantId: string };
const ORIGIN_OK = 'https://shop.example.com';

void before(async () => { h = await makeHarness(); });
void beforeEach(async () => {
  await h.db.unsafe('TRUNCATE users, merchants, sessions, oauth_flows, api_keys, webhook_secrets, payment_intents, payment_status_events, deposits, payout_address_changes CASCADE');
  h.mails.length = 0; h.blocklist.clear(); h.chainState.fail = false; h.chainState.calls = 0;
  h.deps.contracts = testContracts;
  acct = await h.onboard('shop', { origin: ORIGIN_OK });
});
void after(async () => { await h.close(); });

const create = (body: Record<string, unknown> = intentBody(), key: string = idem(), apiKey: string = acct.apiKey) =>
  h.call('POST', '/v1/payment-intents', { apiKey, body, headers: { 'idempotency-key': key } });

void describe('create payment intent', () => {
  void it('creates a 30 minute intent with the fee breakdown and a deterministic receiver', async () => {
    const res = await create();
    assert.equal(res.status, 201);
    const b = res.body;
    assert.match(b.payment_id as string, /^pi_[0-9a-f]{32}$/);
    assert.equal(b.status, 'awaiting_payment');
    assert.equal(b.amount, '10.00');
    assert.equal(b.currency, 'USDC');
    assert.deepEqual(b.fees, { protocol_fee: '0.10', keeper_reimbursement: '0.02', merchant_net: '9.88' });
    assert.equal(new Date(b.expires_at as string).getTime() - h.clock.now.getTime(), 30 * 60 * 1000);
    assert.equal(b.checkout_url, `http://localhost:5173/pay/${b.public_id as string}`);
    assert.match(b.receiver_address as string, /^0x[0-9a-f]{40}$/);

    const row = (await h.db`SELECT terms_hash, receiver_address, gross_units FROM payment_intents`)[0];
    assert.equal(row?.receiver_address, deriveReceiverAddress(DISTRIBUTOR, row?.terms_hash as Hex).toLowerCase());
    assert.equal(row?.gross_units, '10000000');
  });

  void it('records created then awaiting_payment transactionally', async () => {
    await create();
    const events = await h.db`SELECT from_status, to_status FROM payment_status_events ORDER BY id`;
    assert.deepEqual(events.map((e) => e.to_status as string), ['created', 'awaiting_payment']);
  });

  void it('rejects invalid amounts, precision, currency, network and unknown fields', async () => {
    for (const bad of [
      intentBody({ amount: '0.99' }), intentBody({ amount: '1.0000001' }), intentBody({ amount: '-5' }), intentBody({ amount: '1e3' }),
      intentBody({ amount: 10 }), intentBody({ amount: '100000.01' }), intentBody({ currency: 'EURC' }), intentBody({ network: 'ethereum' }),
      intentBody({ order_id: '' }), intentBody({ order_id: 'a'.repeat(129) }), intentBody({ merchant_id: 'x' }),
    ]) {
      assert.equal((await create(bad)).status, 422, JSON.stringify(bad));
    }
    assert.equal((await create(intentBody({ amount: '1' }))).status, 201);
  });

  void it('requires an Idempotency-Key and JSON', async () => {
    const noKey = await h.call('POST', '/v1/payment-intents', { apiKey: acct.apiKey, body: intentBody() });
    assert.equal((noKey.body.error as { code: string }).code, 'idempotency_key_required');
    const badKey = await create(intentBody(), 'short');
    assert.equal(badKey.status, 422);
    const notJson = await h.call('POST', '/v1/payment-intents', { apiKey: acct.apiKey, body: 'amount=1', headers: { 'content-type': 'text/plain', 'idempotency-key': idem() } });
    assert.equal(notJson.status, 400);
  });

  void it('needs a configured payout address', async () => {
    const s = await h.login('nopayout');
    await h.call('POST', '/v1/merchant', { session: s, body: { display_name: 'No payout' } });
    const key = (await h.call('POST', '/v1/merchant/api-keys', { session: s, body: { label: 'k' } })).body.secret as string;
    const res = await create(intentBody(), idem(), key);
    assert.equal(res.status, 409);
    assert.equal((res.body.error as { code: string }).code, 'payout_not_configured');
  });

  void it('refuses to invent receivers when contracts are not configured or reimbursement is unset', async () => {
    h.deps.contracts = null;
    const res = await create();
    assert.equal(res.status, 503);
    assert.equal((res.body.error as { code: string }).code, 'contracts_not_configured');
    assert.equal((await h.db`SELECT 1 FROM payment_intents`).length, 0);
    const noReimb = await makeHarness({ env: { KEEPER_REIMBURSEMENT_USDC: '' } });
    try {
      const a = await noReimb.onboard('nr');
      const r = await noReimb.call('POST', '/v1/payment-intents', { apiKey: a.apiKey, body: intentBody(), headers: { 'idempotency-key': idem() } });
      assert.equal((r.body.error as { code: string }).code, 'keeper_reimbursement_not_configured');
    } finally {
      await noReimb.close();
    }
  });

  void it('blocks blocklisted payout or refund addresses and fails closed on RPC errors', async () => {
    h.blocklist.add(CUSTOMER_ADDRESS);
    assert.equal((await create(intentBody({ refund_address: CUSTOMER_ADDRESS }))).status, 422);
    h.blocklist.clear();
    h.chainState.fail = true;
    assert.equal((await create()).status, 503);
    h.chainState.fail = false;
    const ok = await create(intentBody({ refund_address: CUSTOMER_ADDRESS }));
    assert.equal(ok.body.refund_address, CUSTOMER_ADDRESS);
  });

  void it('defaults the refund address to the merchant payout address', async () => {
    assert.equal((await create()).body.refund_address, MERCHANT_ADDRESS);
  });
});

void describe('return URL validation', () => {
  void it('accepts URLs on the allowlisted origin only', async () => {
    const ok = await create(intentBody({ success_url: `${ORIGIN_OK}/thanks`, cancel_url: `${ORIGIN_OK}/cart` }));
    assert.equal(ok.status, 201);
    assert.equal(ok.body.success_url, `${ORIGIN_OK}/thanks`);
    for (const bad of ['https://evil.example/thanks', 'javascript:alert(1)', 'http://shop.example.com/x', 'https://shop.example.com.evil.example/x', `https://user:pw@shop.example.com/x`, 'data:text/html,x', 'not a url']) {
      assert.equal((await create(intentBody({ success_url: bad }))).status, 422, bad);
    }
  });

  void it('rejects return URLs when no origin is configured', async () => {
    const other = await h.onboard('noorigin');
    const res = await create(intentBody({ success_url: `${ORIGIN_OK}/x` }), idem(), other.apiKey);
    assert.equal((res.body.error as { code: string }).code, 'return_origin_not_configured');
  });
});

void describe('idempotency', () => {
  void it('replays the same key and body without creating a second intent', async () => {
    const key = idem();
    const a = await create(intentBody(), key);
    const b = await create(intentBody(), key);
    assert.equal(b.status, 200);
    assert.equal(b.headers.get('idempotent-replayed'), 'true');
    assert.equal(a.body.payment_id, b.body.payment_id);
    assert.equal(a.body.receiver_address, b.body.receiver_address);
    assert.equal((await h.db`SELECT 1 FROM payment_intents`).length, 1);
  });

  void it('rejects the same key with different parameters', async () => {
    const key = idem();
    await create(intentBody(), key);
    const res = await create(intentBody({ amount: '11.00' }), key);
    assert.equal(res.status, 422);
    assert.equal((res.body.error as { code: string }).code, 'idempotency_key_reused');
  });

  void it('creates exactly one intent under concurrent requests with one key', async () => {
    const key = idem();
    const results = await Promise.all(Array.from({ length: 8 }, () => create(intentBody(), key)));
    assert.ok(results.every((r) => r.status === 200 || r.status === 201));
    assert.equal(new Set(results.map((r) => r.body.payment_id)).size, 1);
    assert.equal((await h.db`SELECT 1 FROM payment_intents`).length, 1);
  });

  void it('scopes keys per merchant', async () => {
    const other = await h.onboard('other-shop');
    const key = idem();
    const a = await create(intentBody(), key);
    const b = await create(intentBody(), key, other.apiKey);
    assert.equal(b.status, 201);
    assert.notEqual(a.body.payment_id, b.body.payment_id);
  });
});

void describe('payout snapshot, expiry and retry', () => {
  void it('keeps the payout address of earlier intents after a confirmed payout change', async () => {
    const first = await create();
    await h.call('POST', '/v1/merchant/payout-address/change', { session: acct.session, body: { new_address: OTHER_ADDRESS } });
    const token = /token=([A-Za-z0-9_-]+)/.exec(h.mails[0]?.text ?? '')?.[1] ?? '';
    await h.call('POST', '/v1/merchant/payout-address/confirm', { session: acct.session, body: { token } });
    const second = await create();
    const old = await h.call('GET', `/v1/payment-intents/${first.body.payment_id as string}`, { apiKey: acct.apiKey });
    assert.equal(old.body.payout_address, MERCHANT_ADDRESS);
    assert.equal(second.body.payout_address, OTHER_ADDRESS);
    assert.notEqual(first.body.receiver_address, second.body.receiver_address);
  });

  void it('freezes the commercial terms in the database', async () => {
    await create();
    await assert.rejects(h.db`UPDATE payment_intents SET payout_address = ${OTHER_ADDRESS}`, /immutable/);
    await assert.rejects(h.db`UPDATE payment_intents SET gross_units = 2000000`, /immutable/);
    await assert.rejects(h.db`UPDATE payment_intents SET receiver_address = ${OTHER_ADDRESS}`, /immutable/);
  });

  void it('expires after 30 minutes and a retry gets a brand new intent and receiver', async () => {
    const key = idem();
    const first = await create(intentBody(), key);
    const publicId = first.body.public_id as string;

    h.clock.advance(30 * 60 * 1000 - 1000);
    assert.equal((await h.call('GET', `/public/payments/${publicId}/status`)).body.status, 'awaiting_payment');
    h.clock.advance(1000);
    assert.equal((await h.call('GET', `/public/payments/${publicId}/status`)).body.status, 'expired');
    assert.equal((await h.db`SELECT status FROM payment_intents`)[0]?.status, 'awaiting_payment');

    // Not before the scanner has read past the expiry: a deposit at 30:00 might still be unread.
    assert.equal((await expireOverdue(h.db, h.clock.now, null)).length, 0);
    assert.equal((await expireOverdue(h.db, h.clock.now, new Date(h.clock.now.getTime() - 5000))).length, 0);
    assert.equal((await expireOverdue(h.db, h.clock.now, new Date(h.clock.now.getTime() + 1000))).length, 1);
    assert.equal((await h.db`SELECT status FROM payment_intents`)[0]?.status, 'expired');
    assert.equal((await expireOverdue(h.db, h.clock.now, new Date(h.clock.now.getTime() + 1000))).length, 0);

    const sameKey = await create(intentBody(), key);
    assert.equal(sameKey.body.payment_id, first.body.payment_id);
    const retry = await create(intentBody());
    assert.equal(retry.status, 201);
    assert.notEqual(retry.body.payment_id, first.body.payment_id);
    assert.notEqual(retry.body.receiver_address, first.body.receiver_address);
    assert.notEqual(retry.body.public_id, first.body.public_id);
  });

  void it('never expires an intent that already has an on-time deposit', async () => {
    const first = await create();
    const row = (await h.db`SELECT id FROM payment_intents`)[0];
    await h.db`INSERT INTO deposits (payment_intent_id, chain_id, tx_hash, log_index, block_number, block_timestamp, amount_units, on_time)
      VALUES (${row?.id as string}, 5042002, ${`0x${'ab'.repeat(32)}`}, 0, 1, ${h.clock.now}, 10000000, true)`;
    h.clock.advance(31 * 60 * 1000);
    assert.equal((await expireOverdue(h.db, h.clock.now, new Date(h.clock.now.getTime() + 1000))).length, 0);
    assert.equal(first.status, 201);
  });
});

void describe('reads, pagination and the public checkout view', () => {
  void it('lists newest first with a stable cursor and status filter', async () => {
    const ids: string[] = [];
    for (let i = 0; i < 5; i += 1) {
      h.clock.advance(1000);
      ids.push((await create(intentBody({ order_id: `o-${i}` }))).body.payment_id as string);
    }
    const page1 = await h.call('GET', '/v1/payments?limit=2', { apiKey: acct.apiKey });
    const page2 = await h.call('GET', `/v1/payments?limit=2&cursor=${page1.body.next_cursor as string}`, { apiKey: acct.apiKey });
    const page3 = await h.call('GET', `/v1/payments?limit=2&cursor=${page2.body.next_cursor as string}`, { apiKey: acct.apiKey });
    const seen = [...(page1.body.data as { payment_id: string }[]), ...(page2.body.data as { payment_id: string }[]), ...(page3.body.data as { payment_id: string }[])].map((p) => p.payment_id);
    assert.deepEqual(seen, [...ids].reverse());
    assert.equal(page3.body.next_cursor, null);
    assert.equal(((await h.call('GET', '/v1/payments?status=settled', { apiKey: acct.apiKey })).body.data as unknown[]).length, 0);
    assert.equal((await h.call('GET', '/v1/payments?limit=101', { apiKey: acct.apiKey })).status, 422);
    assert.equal((await h.call('GET', '/v1/payments?cursor=garbage', { apiKey: acct.apiKey })).status, 400);
  });

  void it('serves a safe public view from the database without touching the chain', async () => {
    const made = await create(intentBody({ success_url: `${ORIGIN_OK}/thanks` }));
    const callsBefore = h.chainState.calls;
    const publicId = made.body.public_id as string;
    const view = await h.call('GET', `/public/payments/${publicId}`);
    assert.equal(view.status, 200);
    assert.deepEqual(Object.keys(view.body).sort(), [
      'amount', 'cancel_url', 'chain_id', 'currency', 'description', 'expires_at', 'livemode', 'merchant_name', 'network',
      'order_reference', 'public_id', 'received', 'receiver_address', 'settlement', 'status', 'success_url', 'usdc_address',
    ]);
    assert.equal(view.body.order_reference, 'order-1');
    assert.equal(view.body.received, '0.00');
    assert.equal(view.body.settlement, null);
    for (const secret of [acct.apiKey, acct.merchantId, MERCHANT_ADDRESS, 'merchant_net', 'terms']) {
      assert.ok(!view.text.includes(secret), `public view leaked ${secret}`);
    }
    assert.equal(view.headers.get('cache-control'), 'no-store');
    const status = await h.call('GET', `/public/payments/${publicId}/status`);
    assert.deepEqual(Object.keys(status.body).sort(), ['expires_at', 'public_id', 'received', 'server_time', 'settlement', 'status']);
    assert.equal(h.chainState.calls, callsBefore);
    assert.equal((await h.call('GET', '/public/payments/does-not-exist')).status, 404);
    assert.equal((await h.call('GET', `/public/payments/${'A'.repeat(22)}`)).status, 404);
  });
});
