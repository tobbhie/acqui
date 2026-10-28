import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { after, afterEach, before, beforeEach, describe, it } from 'node:test';
import { DEFAULT_LIMITS } from './app';
import { verifyWebhookSignature } from './routes/demo';
import { makeHarness, testContracts, ORIGIN, type Harness } from './testing';

const SECRET = 'whsec_demo_secret_for_tests_only_000000';
const settledBody = (paymentId: string, tx: string | null) =>
  JSON.stringify({ id: 'd1', type: 'payment.settled', data: { payment_id: paymentId, settlement_tx_hash: tx } });
const sign = (body: string, t: number, secret = SECRET) => `v1=${createHmac('sha256', secret).update(`${t}.${body}`).digest('hex')}`;
const TX = `0x${'ab'.repeat(32)}`;

void describe('demo store backend', () => {
  let h: Harness;
  let apiKey: string;
  let merchantId: string;

  const wire = (harness: Harness) => {
    harness.deps.selfFetch = (url, init) => {
      const u = new URL(url);
      return Promise.resolve(harness.app.request(`${u.pathname}${u.search}`, init));
    };
  };

  beforeEach(async () => {
    h = await makeHarness();
    ({ apiKey, merchantId } = await h.onboard('demo-merchant', { origin: ORIGIN }));
    wire(h);
    h.deps.config.DEMO_MERCHANT_API_KEY = apiKey;
    h.deps.config.DEMO_WEBHOOK_SECRET = SECRET;
  });
  afterEach(async () => h.close());
  before(() => undefined);
  after(() => undefined);

  const order = async (product_id = 'sticker-pack') => h.call('POST', '/demo/orders', { body: { product_id } });

  void it('lists the catalogue and reports whether the demo is configured', async () => {
    const res = await h.call('GET', '/demo/products');
    assert.equal(res.body.enabled, true);
    assert.equal((res.body.products as unknown[]).length, 2);
    h.deps.config.DEMO_MERCHANT_API_KEY = undefined;
    assert.equal((await h.call('GET', '/demo/products')).body.enabled, false);
    assert.equal((await order()).status, 503);
  });

  void it('creates a real payment intent server-side and never exposes the key', async () => {
    const res = await order();
    assert.equal(res.status, 201);
    const orderId = res.body.order_id as string;
    assert.match(res.body.checkout_url as string, /\/pay\/[\w-]{22}$/);
    assert.ok(!res.text.includes(apiKey));
    const [p] = await h.db`SELECT order_id, description, success_url, cancel_url, gross_units, merchant_id FROM payment_intents`;
    assert.equal(p?.order_id, `demo-${orderId}`);
    assert.equal(p?.description, 'Acqui sticker pack');
    assert.equal(p?.success_url, `${ORIGIN}/demo/order/${orderId}`);
    assert.equal(p?.gross_units, '1000000');
    assert.equal(p?.merchant_id, merchantId);
    const [d] = await h.db`SELECT status, payment_id FROM demo_orders WHERE id = ${orderId}`;
    assert.equal(d?.status, 'pending');
    assert.ok(d?.payment_id);
  });

  void it('stays pending after the customer comes back until the payment API says settled', async () => {
    const orderId = (await order('canvas-tote')).body.order_id as string;
    for (let i = 0; i < 3; i += 1) {
      const r = await h.call('GET', `/demo/orders/${orderId}`);
      assert.equal(r.body.fulfilment, 'pending');
      assert.equal(r.body.verification, 'verified');
      assert.equal(r.body.settlement_tx_hash, null);
      assert.ok(r.body.checkout_url);
    }
    await h.db`UPDATE payment_intents SET status = 'settling' WHERE true`;
    assert.equal((await h.call('GET', `/demo/orders/${orderId}`)).body.fulfilment, 'pending');
  });

  void it('marks the order paid only from a verified settled payment, and shows its transaction', async () => {
    const orderId = (await order()).body.order_id as string;
    await h.db`UPDATE payment_intents SET status = 'settled', settlement_tx_hash = ${TX}, settled_at = now() WHERE true`;
    const r = await h.call('GET', `/demo/orders/${orderId}`);
    assert.equal(r.body.fulfilment, 'paid');
    assert.equal(r.body.settlement_tx_hash, TX);
    assert.equal(r.body.confirmed_via, 'api');
    assert.equal(r.body.checkout_url, null);
  });

  void it('reports expired and attention states, and falls back honestly when verification is unavailable', async () => {
    const orderId = (await order()).body.order_id as string;
    await h.db`UPDATE payment_intents SET status = 'expired' WHERE true`;
    assert.equal((await h.call('GET', `/demo/orders/${orderId}`)).body.fulfilment, 'expired');
    await h.db`UPDATE payment_intents SET status = 'underpaid' WHERE true`;
    assert.equal((await h.call('GET', `/demo/orders/${orderId}`)).body.fulfilment, 'attention');
    h.deps.selfFetch = () => Promise.reject(new Error('network down'));
    const r = await h.call('GET', `/demo/orders/${orderId}`);
    assert.equal(r.body.verification, 'unavailable');
    assert.notEqual(r.body.fulfilment, 'paid');
  });

  void it('surfaces a payments outage instead of inventing a checkout', async () => {
    await h.close();
    h = await makeHarness({ contracts: null });
    ({ apiKey } = await h.onboard('demo-merchant', { origin: ORIGIN }));
    wire(h);
    h.deps.config.DEMO_MERCHANT_API_KEY = apiKey;
    const res = await order();
    assert.equal(res.status, 503);
    assert.equal(res.body.error && (res.body.error as { code: string }).code, 'payments_unavailable');
    const [d] = await h.db`SELECT status FROM demo_orders`;
    assert.equal(d?.status, 'failed');
    void testContracts;
  });

  void it('validates input and unknown orders', async () => {
    assert.equal((await order('nope')).status, 422);
    assert.equal((await h.call('POST', '/demo/orders', { body: { product_id: 'sticker-pack', price: '0.01' } })).status, 422);
    assert.equal((await h.call('GET', '/demo/orders/not-a-uuid')).status, 422);
    assert.equal((await h.call('GET', '/demo/orders/00000000-0000-4000-8000-000000000000')).status, 404);
  });

  void it('rate limits order creation per IP', async () => {
    await h.close();
    h = await makeHarness({ limits: { ...DEFAULT_LIMITS, perIpPerMinute: 100_000, demoOrdersPerIpPerMinute: 2 } });
    ({ apiKey } = await h.onboard('demo-merchant', { origin: ORIGIN }));
    wire(h);
    h.deps.config.DEMO_MERCHANT_API_KEY = apiKey;
    assert.equal((await order()).status, 201);
    assert.equal((await order()).status, 201);
    assert.equal((await order()).status, 429);
  });

  void describe('signed webhook receiver', () => {
    const post = (body: string, headers: Record<string, string>) => h.call('POST', '/demo/webhook', { headers: { 'content-type': 'application/json', ...headers }, body });

    void it('accepts a correctly signed payment.settled and marks the order paid', async () => {
      const orderId = (await order()).body.order_id as string;
      const [d] = await h.db`SELECT payment_id FROM demo_orders WHERE id = ${orderId}`;
      const body = settledBody(d?.payment_id as string, TX);
      const t = Math.floor(h.clock.now.getTime() / 1000);
      const res = await post(body, { 'acqui-timestamp': String(t), 'acqui-signature': sign(body, t) });
      assert.equal(res.status, 200);
      const [after] = await h.db`SELECT status, confirmed_via, settlement_tx_hash FROM demo_orders WHERE id = ${orderId}`;
      assert.deepEqual({ ...after }, { status: 'paid', confirmed_via: 'webhook', settlement_tx_hash: TX });
    });

    void it('rejects unsigned, tampered, wrong-secret and stale requests', async () => {
      const orderId = (await order()).body.order_id as string;
      const [d] = await h.db`SELECT payment_id FROM demo_orders WHERE id = ${orderId}`;
      const body = settledBody(d?.payment_id as string, TX);
      const t = Math.floor(h.clock.now.getTime() / 1000);
      assert.equal((await post(body, {})).status, 401);
      assert.equal((await post(body.replace('settled', 'settleX'), { 'acqui-timestamp': String(t), 'acqui-signature': sign(body, t) })).status, 401);
      assert.equal((await post(body, { 'acqui-timestamp': String(t), 'acqui-signature': sign(body, t, 'whsec_other_secret_value_0000') })).status, 401);
      assert.equal((await post(body, { 'acqui-timestamp': String(t - 600), 'acqui-signature': sign(body, t - 600) })).status, 401);
      const [still] = await h.db`SELECT status FROM demo_orders WHERE id = ${orderId}`;
      assert.equal(still?.status, 'pending');
    });

    void it('ignores events for unknown payments without erroring', async () => {
      const body = settledBody('pi_unknown', TX);
      const t = Math.floor(h.clock.now.getTime() / 1000);
      assert.equal((await post(body, { 'acqui-timestamp': String(t), 'acqui-signature': sign(body, t) })).status, 200);
    });
  });

  void it('verifyWebhookSignature is strict about format and clock', () => {
    const body = '{"a":1}';
    const t = 1_000_000;
    assert.equal(verifyWebhookSignature(SECRET, { timestamp: String(t), signature: sign(body, t) }, body, t), true);
    assert.equal(verifyWebhookSignature(SECRET, { timestamp: String(t), signature: sign(body, t).toUpperCase() }, body, t), false);
    assert.equal(verifyWebhookSignature(SECRET, { timestamp: 'abc', signature: sign(body, t) }, body, t), false);
    assert.equal(verifyWebhookSignature(SECRET, { timestamp: String(t), signature: undefined }, body, t), false);
    assert.equal(verifyWebhookSignature(SECRET, { timestamp: String(t), signature: sign(body, t) }, body, t + 301), false);
  });
});
