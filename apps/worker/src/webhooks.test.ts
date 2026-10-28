// arc-studio-allow-onchain-literal (test fixtures)
import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { makeHarness, intentBody, idem, type Harness, type Session } from '../../api/src/testing';
import { rotateWebhookSecret } from '../../api/src/webhookSecrets';
import { isPublicIp, resolvePublicAddress, UnsafeDestinationError } from './ssrf';
import { silentLogger } from './types';
import {
  createSafePoster, deliverDue, enqueueWebhook, nextDelaySeconds, signWebhook, RETRY_DELAYS_SECONDS, MAX_ATTEMPTS,
  type DeliveryCtx, type PostRequest,
} from './webhooks';

const KEY = 'ab'.repeat(32);
let h: Harness;
let session: Session;
let apiKey: string;
let merchantId: string;
let secret: string;
let sent: PostRequest[];
let responses: (number | Error)[];
let failures: string[];

const ctx = (): DeliveryCtx => ({
  db: h.db, encryptionKey: KEY, production: false, now: () => h.clock.now, log: silentLogger, random: () => 0.5,
  onFailure: (code) => failures.push(code),
  post: (req) => {
    sent.push(req);
    const next = responses.shift() ?? 200;
    return next instanceof Error ? Promise.reject(next) : Promise.resolve({ status: next });
  },
});

beforeEach(async () => {
  h = await makeHarness();
  const m = await h.onboard('hook-merchant');
  session = m.session; apiKey = m.apiKey; merchantId = m.merchantId;
  await h.call('PATCH', '/v1/merchant', { session, body: { webhook_url: 'https://hooks.example.com/acqui' } });
  secret = (await rotateWebhookSecret(h.db, merchantId, KEY)).secret;
  sent = []; responses = []; failures = [];
});
afterEach(async () => { await h.close(); });

async function settledPayment(): Promise<string> {
  const res = await h.call('POST', '/v1/payment-intents', { apiKey, body: intentBody({ order_id: 'order-77' }), headers: { 'idempotency-key': idem() } });
  const id = (await h.db`SELECT id FROM payment_intents WHERE receiver_address = ${(res.body.receiver_address as string).toLowerCase()}`)[0]?.id as string;
  await h.db`UPDATE payment_intents SET status = 'settled', settlement_tx_hash = ${`0x${'cd'.repeat(32)}`}, settled_at = ${h.clock.now} WHERE id = ${id}`;
  return id;
}
const delivery = async (id: string) => (await h.db`SELECT * FROM webhook_deliveries WHERE payment_intent_id = ${id}`)[0];

void describe('webhook outbox', () => {
  void it('queues one payment.settled event with the final figures, chain and settlement transaction', async () => {
    const id = await settledPayment();
    assert.equal(await enqueueWebhook(h.db, id, 'payment.settled', h.clock.now), true);
    assert.equal(await enqueueWebhook(h.db, id, 'payment.settled', h.clock.now), false, 'idempotent per payment and event');
    const d = await delivery(id);
    const body = JSON.parse(d?.body as string) as { id: string; type: string; data: Record<string, unknown> };
    assert.equal(body.id, d?.id);
    assert.equal(body.type, 'payment.settled');
    assert.deepEqual(
      { ...body.data, payment_id: 'x', receiver_address: 'x', settled_at: 'x' },
      { payment_id: 'x', order_id: 'order-77', status: 'settled', currency: 'USDC', gross: '10.00', fee: '0.10', keeper_reimbursement: '0.02', net: '9.88',
        network: 'arc', chain_id: 5042002, receiver_address: 'x', settlement_tx_hash: `0x${'cd'.repeat(32)}`, settled_at: 'x' },
    );
  });

  void it('refuses to queue payment.settled for an unsettled payment and skips merchants without a URL', async () => {
    const res = await h.call('POST', '/v1/payment-intents', { apiKey, body: intentBody(), headers: { 'idempotency-key': idem() } });
    const id = (await h.db`SELECT id FROM payment_intents WHERE receiver_address = ${(res.body.receiver_address as string).toLowerCase()}`)[0]?.id as string;
    await assert.rejects(enqueueWebhook(h.db, id, 'payment.settled', h.clock.now), /settled payment/);
    await h.call('PATCH', '/v1/merchant', { session, body: { webhook_url: null } });
    const sid = await settledPayment();
    assert.equal(await enqueueWebhook(h.db, sid, 'payment.settled', h.clock.now), false);
  });
});

void describe('webhook delivery', () => {
  void it('signs the exact raw body with the merchant secret and sends stable ids', async () => {
    const id = await settledPayment();
    await enqueueWebhook(h.db, id, 'payment.settled', h.clock.now);
    const result = await deliverDue(ctx());
    assert.deepEqual(result, { delivered: 1, failed: 0, retried: 0 });
    const req = sent[0];
    const d = await delivery(id);
    const ts = Number(req.headers['acqui-timestamp']);
    assert.equal(ts, Math.floor(h.clock.now.getTime() / 1000));
    assert.equal(req.headers['acqui-signature'], `v1=${signWebhook(secret, ts, req.body)}`);
    assert.equal(req.body, d?.body, 'the stored bytes are the signed bytes');
    assert.equal(req.headers['acqui-delivery-id'], d?.id);
    assert.equal(req.headers['acqui-event'], 'payment.settled');
    assert.equal(req.url, 'https://hooks.example.com/acqui');
    assert.equal(d?.status, 'delivered');
    assert.deepEqual(await deliverDue(ctx()), { delivered: 0, failed: 0, retried: 0 }, 'delivered events are never resent');
  });

  void it('retries with exponential backoff, same delivery id and body, fresh timestamp', async () => {
    const id = await settledPayment();
    await enqueueWebhook(h.db, id, 'payment.settled', h.clock.now);
    responses.push(500, 503, 200);
    const start = h.clock.now.getTime();
    await deliverDue(ctx());
    assert.equal(((await delivery(id))?.next_attempt_at as Date).getTime() - start, 30_000);
    assert.deepEqual(await deliverDue(ctx()), { delivered: 0, failed: 0, retried: 0 }, 'not due yet');
    h.clock.advance(30_000);
    await deliverDue(ctx());
    assert.equal(((await delivery(id))?.next_attempt_at as Date).getTime() - h.clock.now.getTime(), 60_000);
    h.clock.advance(60_000);
    await deliverDue(ctx());
    assert.equal(sent.length, 3);
    assert.equal(new Set(sent.map((r) => r.headers['acqui-delivery-id'])).size, 1);
    assert.equal(new Set(sent.map((r) => r.body)).size, 1);
    assert.notEqual(sent[0]?.headers['acqui-timestamp'], sent[2]?.headers['acqui-timestamp']);
    assert.equal((await delivery(id))?.status, 'delivered');
    assert.equal((await delivery(id))?.attempts, 3);
  });

  void it('gives up after the last retry and raises an alert', async () => {
    const id = await settledPayment();
    await enqueueWebhook(h.db, id, 'payment.settled', h.clock.now);
    responses.push(...Array<number>(MAX_ATTEMPTS + 2).fill(500));
    for (let n = 0; n < MAX_ATTEMPTS; n += 1) {
      await deliverDue(ctx());
      h.clock.advance(((RETRY_DELAYS_SECONDS[n] ?? 0) + 1) * 1000);
    }
    assert.equal((await delivery(id))?.status, 'failed');
    assert.equal(sent.length, MAX_ATTEMPTS);
    assert.deepEqual(failures, ['webhook_delivery_failed']);
    assert.equal(nextDelaySeconds(MAX_ATTEMPTS, () => 0.5), null);
  });

  void it('never sends unsigned: with no active secret it waits, then delivers once a secret exists', async () => {
    const id = await settledPayment();
    await enqueueWebhook(h.db, id, 'payment.settled', h.clock.now);
    await h.db`UPDATE webhook_secrets SET revoked_at = now()`;
    await deliverDue(ctx());
    assert.equal(sent.length, 0);
    assert.equal((await delivery(id))?.last_error, 'no_active_signing_secret');
    await rotateWebhookSecret(h.db, merchantId, KEY);
    h.clock.advance(31_000);
    await deliverDue(ctx());
    assert.equal(sent.length, 1);
    assert.equal((await delivery(id))?.status, 'delivered');
  });

  void it('treats a redirect as a failure and a fixed endpoint receives queued events', async () => {
    const id = await settledPayment();
    await enqueueWebhook(h.db, id, 'payment.settled', h.clock.now);
    responses.push(302);
    await deliverDue(ctx());
    assert.equal((await delivery(id))?.last_error, 'redirect_not_followed');
    await h.call('PATCH', '/v1/merchant', { session, body: { webhook_url: 'https://fixed.example.com/hook' } });
    h.clock.advance(31_000);
    await deliverDue(ctx());
    assert.equal(sent[1]?.url, 'https://fixed.example.com/hook');
  });

  void it('fails permanently when the merchant removed the URL', async () => {
    const id = await settledPayment();
    await enqueueWebhook(h.db, id, 'payment.settled', h.clock.now);
    await h.call('PATCH', '/v1/merchant', { session, body: { webhook_url: null } });
    await deliverDue(ctx());
    assert.equal((await delivery(id))?.status, 'failed');
    assert.equal(sent.length, 0);
  });

  void it('concurrent delivery workers cannot send the same event twice', async () => {
    const id = await settledPayment();
    await enqueueWebhook(h.db, id, 'payment.settled', h.clock.now);
    await Promise.all([deliverDue(ctx()), deliverDue(ctx())]);
    assert.equal(sent.length, 1);
  });
});

void describe('SSRF protection', () => {
  void it('classifies addresses', () => {
    for (const ip of ['8.8.8.8', '1.1.1.1', '93.184.216.34', '2606:4700:4700::1111']) assert.equal(isPublicIp(ip), true, ip);
    for (const ip of [
      '127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '224.0.0.1', '255.255.255.255',
      '::1', '::', 'fe80::1', 'fc00::1', 'fd12:3456::1', '::ffff:127.0.0.1', '::ffff:10.0.0.1', '::ffff:a9fe:a9fe', '64:ff9b::7f00:1', '2001:db8::1', 'ff02::1', 'not-an-ip',
    ]) assert.equal(isPublicIp(ip), false, ip);
  });

  void it('refuses a host if ANY DNS answer is private (rebinding trick) and pins the checked address', async () => {
    await assert.rejects(resolvePublicAddress('evil.example', () => Promise.resolve([{ address: '8.8.8.8', family: 4 }, { address: '10.0.0.5', family: 4 }])), UnsafeDestinationError);
    await assert.rejects(resolvePublicAddress('metadata.example', () => Promise.resolve([{ address: '169.254.169.254', family: 4 }])), UnsafeDestinationError);
    await assert.rejects(resolvePublicAddress('nx.example', () => Promise.reject(new Error('ENOTFOUND'))), UnsafeDestinationError);
    assert.deepEqual(await resolvePublicAddress('ok.example', () => Promise.resolve([{ address: '93.184.216.34', family: 4 }])), { address: '93.184.216.34', family: 4 });
    await assert.rejects(resolvePublicAddress('127.0.0.1'), UnsafeDestinationError);
  });

  void it('the poster blocks private destinations before any connection is made', async () => {
    const post = createSafePoster({ lookup: () => Promise.resolve([{ address: '10.0.0.9', family: 4 }]) });
    await assert.rejects(post({ url: 'https://internal.example/hook', headers: {}, body: '{}', timeoutMs: 500 }), UnsafeDestinationError);
    await assert.rejects(createSafePoster()({ url: 'http://example.com/hook', headers: {}, body: '{}', timeoutMs: 500 }), /https/);
    await assert.rejects(createSafePoster()({ url: 'https://user:pw@example.com/hook', headers: {}, body: '{}', timeoutMs: 500 }), UnsafeDestinationError);
  });

  void it('production delivery records a blocked destination as a failed attempt and sends nothing', async () => {
    const id = await settledPayment();
    await enqueueWebhook(h.db, id, 'payment.settled', h.clock.now);
    const c = ctx();
    c.post = createSafePoster({ lookup: () => Promise.resolve([{ address: '127.0.0.1', family: 4 }]) });
    await deliverDue(c);
    assert.match((await delivery(id))?.last_error as string, /^blocked:/);
  });
});

void describe('safe poster against a local server', () => {
  let server: Server;
  let port = 0;
  const hits: { path: string; headers: IncomingMessage['headers']; body: string }[] = [];

  beforeEach(async () => {
    hits.length = 0;
    server = createServer((req, res) => {
      let body = '';
      req.on('data', (c: Buffer) => { body += c.toString(); });
      req.on('end', () => {
        hits.push({ path: req.url ?? '', headers: req.headers, body });
        if (req.url === '/redirect') { res.writeHead(302, { location: `http://127.0.0.1:${port}/followed` }).end(); return; }
        if (req.url === '/hang') return;
        if (req.url === '/big') { res.writeHead(200).end('x'.repeat(200_000)); return; }
        res.writeHead(204).end();
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    port = (server.address() as AddressInfo).port;
  });
  afterEach(() => { server.closeAllConnections(); server.close(); });
  const post = createSafePoster({ unsafeAllowHttpForTests: true });

  void it('delivers the body and headers untouched, and never follows redirects', async () => {
    const ok = await post({ url: `http://127.0.0.1:${port}/ok`, headers: { 'x-test': '1' }, body: '{"a":1}', timeoutMs: 2000 });
    assert.equal(ok.status, 204);
    assert.equal(hits[0]?.body, '{"a":1}');
    assert.equal(hits[0]?.headers['x-test'], '1');
    const redirected = await post({ url: `http://127.0.0.1:${port}/redirect`, headers: {}, body: '{}', timeoutMs: 2000 });
    assert.equal(redirected.status, 302);
    assert.ok(!hits.some((x) => x.path === '/followed'), 'the Location target is never requested');
  });

  void it('times out on a silent server and caps a huge response', async () => {
    await assert.rejects(post({ url: `http://127.0.0.1:${port}/hang`, headers: {}, body: '{}', timeoutMs: 300 }), /timeout|socket|aborted/i);
    const big = await post({ url: `http://127.0.0.1:${port}/big`, headers: {}, body: '{}', timeoutMs: 2000 });
    assert.equal(big.status, 200);
  });
});
