// arc-studio-allow-onchain-literal
import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { loadActiveWebhookSecret } from './webhookSecrets';
import { makeHarness, MERCHANT_ADDRESS, OTHER_ADDRESS, type Harness } from './testing';

let h: Harness;
void before(async () => { h = await makeHarness(); });
void beforeEach(async () => {
  await h.db.unsafe('TRUNCATE users, merchants, sessions, oauth_flows, api_keys, webhook_secrets, payment_intents, payment_status_events, payout_address_changes CASCADE');
  h.mails.length = 0; h.blocklist.clear(); h.chainState.fail = false;
});
void after(async () => { await h.close(); });

const payoutBody = (a: string, over: Record<string, unknown> = {}) => ({ payout_address: a, confirm_address: a, acknowledge: true, ...over });

void describe('merchant profile', () => {
  void it('creates one merchant per account with an immutable id and owner', async () => {
    const session = await h.login('m1');
    const created = await h.call('POST', '/v1/merchant', { session, body: { display_name: 'Acme' } });
    assert.equal(created.status, 201);
    assert.equal((await h.call('POST', '/v1/merchant', { session, body: { display_name: 'Again' } })).status, 409);
    await assert.rejects(h.db`UPDATE merchants SET id = gen_random_uuid()`, /immutable/);
    await assert.rejects(h.db`UPDATE merchants SET owner_user_id = gen_random_uuid()`);
  });

  void it('requires a merchant before settings calls', async () => {
    const session = await h.login('m2');
    assert.equal((await h.call('GET', '/v1/merchant', { session })).status, 409);
  });

  void it('rejects unknown fields and bad names', async () => {
    const session = await h.login('m3');
    assert.equal((await h.call('POST', '/v1/merchant', { session, body: { display_name: 'A' } })).status, 422);
    assert.equal((await h.call('POST', '/v1/merchant', { session, body: { display_name: 'Acme', owner_user_id: 'x' } })).status, 422);
  });
});

void describe('initial payout address review', () => {
  void it('requires acknowledgement and a matching second entry', async () => {
    const session = await h.login('p1');
    await h.call('POST', '/v1/merchant', { session, body: { display_name: 'Acme' } });
    assert.equal((await h.call('POST', '/v1/merchant/payout-address', { session, body: payoutBody(MERCHANT_ADDRESS, { acknowledge: false }) })).status, 422);
    assert.equal((await h.call('POST', '/v1/merchant/payout-address', { session, body: payoutBody(MERCHANT_ADDRESS, { confirm_address: OTHER_ADDRESS }) })).status, 422);
    const ok = await h.call('POST', '/v1/merchant/payout-address', { session, body: payoutBody(MERCHANT_ADDRESS) });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.payout_address, MERCHANT_ADDRESS);
  });

  void it('refuses a blocklisted address and fails closed when the chain is unreachable', async () => {
    const session = await h.login('p2');
    await h.call('POST', '/v1/merchant', { session, body: { display_name: 'Acme' } });
    h.blocklist.add(MERCHANT_ADDRESS);
    assert.equal((await h.call('POST', '/v1/merchant/payout-address', { session, body: payoutBody(MERCHANT_ADDRESS) })).status, 422);
    h.chainState.fail = true;
    assert.equal((await h.call('POST', '/v1/merchant/payout-address', { session, body: payoutBody(OTHER_ADDRESS) })).status, 503);
  });

  void it('cannot be set twice through the initial endpoint', async () => {
    const { session } = await h.onboard('p3');
    assert.equal((await h.call('POST', '/v1/merchant/payout-address', { session, body: payoutBody(OTHER_ADDRESS) })).status, 409);
  });
});

void describe('payout address change by emailed one-time token', () => {
  const tokenFrom = (text: string) => /token=([A-Za-z0-9_-]+)/.exec(text)?.[1] ?? '';

  void it('is disabled when no email channel exists, and the payout stays unchanged', async () => {
    const off = await makeHarness({ email: false });
    try {
      const { session } = await off.onboard('c0');
      const res = await off.call('POST', '/v1/merchant/payout-address/change', { session, body: { new_address: OTHER_ADDRESS } });
      assert.equal(res.status, 503);
      assert.equal((res.body.error as { code: string }).code, 'payout_change_unavailable');
      assert.equal((await off.call('GET', '/v1/merchant', { session })).body.payout_address, MERCHANT_ADDRESS);
      assert.equal((await off.call('GET', '/v1/merchant', { session })).body.payout_changes_enabled, false);
    } finally {
      await off.close();
    }
  });

  void it('keeps the current payout until confirmation, then changes it once and notifies', async () => {
    const { session } = await h.onboard('c1');
    const req = await h.call('POST', '/v1/merchant/payout-address/change', { session, body: { new_address: OTHER_ADDRESS } });
    assert.equal(req.status, 202);
    assert.equal((await h.call('GET', '/v1/merchant', { session })).body.payout_address, MERCHANT_ADDRESS);
    assert.equal(h.mails.length, 1);
    const token = tokenFrom(h.mails[0]?.text ?? '');
    assert.ok(token.length > 30);
    assert.match(h.mails[0]?.text ?? '', /dashboard\/payout\/confirm#token=/);

    const confirmed = await h.call('POST', '/v1/merchant/payout-address/confirm', { session, body: { token } });
    assert.equal(confirmed.status, 200);
    assert.equal(confirmed.body.payout_address, OTHER_ADDRESS);
    assert.equal(h.mails.length, 2);
    assert.match(h.mails[1]?.subject ?? '', /changed/);

    const replay = await h.call('POST', '/v1/merchant/payout-address/confirm', { session, body: { token } });
    assert.equal(replay.status, 422);
  });

  void it('stores only the hash of the token, with a 15 minute expiry', async () => {
    const { session } = await h.onboard('c2');
    await h.call('POST', '/v1/merchant/payout-address/change', { session, body: { new_address: OTHER_ADDRESS } });
    const token = tokenFrom(h.mails[0]?.text ?? '');
    const rows = await h.db`SELECT token_hash, expires_at FROM payout_address_changes`;
    assert.equal((rows[0]?.token_hash as Buffer).toString('hex'), createHash('sha256').update(token).digest('hex'));
    assert.equal((rows[0]?.expires_at as Date).getTime() - h.clock.now.getTime(), 15 * 60 * 1000);
  });

  void it('rejects an expired token and leaves the payout unchanged', async () => {
    const { session } = await h.onboard('c3');
    await h.call('POST', '/v1/merchant/payout-address/change', { session, body: { new_address: OTHER_ADDRESS } });
    const token = tokenFrom(h.mails[0]?.text ?? '');
    h.clock.advance(15 * 60 * 1000 + 1000);
    assert.equal((await h.call('POST', '/v1/merchant/payout-address/confirm', { session, body: { token } })).status, 422);
    assert.equal((await h.call('GET', '/v1/merchant', { session })).body.payout_address, MERCHANT_ADDRESS);
  });

  void it('a newer request supersedes the older token', async () => {
    const { session } = await h.onboard('c4');
    await h.call('POST', '/v1/merchant/payout-address/change', { session, body: { new_address: OTHER_ADDRESS } });
    await h.call('POST', '/v1/merchant/payout-address/change', { session, body: { new_address: '0x4444444444444444444444444444444444444444' } });
    const [first, second] = [tokenFrom(h.mails[0]?.text ?? ''), tokenFrom(h.mails[1]?.text ?? '')];
    assert.equal((await h.call('POST', '/v1/merchant/payout-address/confirm', { session, body: { token: first } })).status, 422);
    assert.equal((await h.call('POST', '/v1/merchant/payout-address/confirm', { session, body: { token: second } })).status, 200);
  });

  void it('another merchant cannot use the token', async () => {
    const a = await h.onboard('c5a');
    const b = await h.onboard('c5b');
    await h.call('POST', '/v1/merchant/payout-address/change', { session: a.session, body: { new_address: OTHER_ADDRESS } });
    const token = tokenFrom(h.mails[0]?.text ?? '');
    assert.equal((await h.call('POST', '/v1/merchant/payout-address/confirm', { session: b.session, body: { token } })).status, 422);
  });

  void it('refuses unchanged, blocklisted and unset-initial requests', async () => {
    const { session } = await h.onboard('c6');
    assert.equal((await h.call('POST', '/v1/merchant/payout-address/change', { session, body: { new_address: MERCHANT_ADDRESS } })).status, 422);
    h.blocklist.add(OTHER_ADDRESS);
    assert.equal((await h.call('POST', '/v1/merchant/payout-address/change', { session, body: { new_address: OTHER_ADDRESS } })).status, 422);
    assert.equal(h.mails.length, 0);
  });
});

void describe('return origin, webhook URL and webhook secret', () => {
  void it('validates the allowed return origin', async () => {
    const { session } = await h.onboard('w1');
    const patch = (origin: string | null) => h.call('PATCH', '/v1/merchant', { session, body: { allowed_return_origin: origin } });
    assert.equal((await patch('https://shop.example.com')).body.allowed_return_origin, 'https://shop.example.com');
    assert.equal((await patch('https://shop.example.com/path')).status, 422);
    assert.equal((await patch('ftp://shop.example.com')).status, 422);
    assert.equal((await patch('http://shop.example.com')).status, 422);
    assert.equal((await patch('https://user:pw@shop.example.com')).status, 422);
    assert.equal((await patch('not a url')).status, 422);
    assert.equal((await patch(null)).body.allowed_return_origin, null);
  });

  void it('accepts only public https webhook URLs', async () => {
    const { session } = await h.onboard('w2');
    const patch = (url: string | null) => h.call('PATCH', '/v1/merchant', { session, body: { webhook_url: url } });
    assert.equal((await patch('https://hooks.example.com/acqui')).status, 200);
    for (const bad of [
      'http://hooks.example.com/x', 'https://localhost/x', 'https://127.0.0.1/x', 'https://10.0.0.5/x',
      'https://169.254.169.254/latest', 'https://192.168.1.1/x', 'https://[::1]/x', 'https://hooks.internal/x',
      'https://intranet/x', 'https://user:pw@hooks.example.com/x', 'https://hooks.example.com:8080/x',
    ]) {
      assert.equal((await patch(bad)).status, 422, bad);
    }
    assert.equal((await patch(null)).body.webhook_url, null);
  });

  void it('shows the signing secret once, stores it encrypted, and rotation leaves one active secret', async () => {
    const { session, merchantId } = await h.onboard('w3');
    const first = await h.call('POST', '/v1/merchant/webhook-secret', { session, body: {} });
    const secret = first.body.secret as string;
    assert.match(secret, /^whsec_/);
    const dump = JSON.stringify(await h.db`SELECT * FROM webhook_secrets`);
    assert.ok(!dump.includes(secret));
    assert.equal(await loadActiveWebhookSecret(h.db, merchantId, h.deps.config.WEBHOOK_SECRET_ENCRYPTION_KEY), secret);
    const settings = await h.call('GET', '/v1/merchant', { session });
    assert.equal(settings.body.webhook_secret_configured, true);
    assert.ok(!settings.text.includes(secret));

    const second = await h.call('POST', '/v1/merchant/webhook-secret', { session, body: {} });
    assert.notEqual(second.body.secret, secret);
    assert.equal((await h.db`SELECT 1 FROM webhook_secrets WHERE revoked_at IS NULL`).length, 1);
    assert.equal(await loadActiveWebhookSecret(h.db, merchantId, h.deps.config.WEBHOOK_SECRET_ENCRYPTION_KEY), second.body.secret);
  });
});
