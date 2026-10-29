import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { loadApiConfig } from '@acqui/shared';
import { createMailer, createOqumailMailer } from './mailer';
import { makeHarness, MERCHANT_ADDRESS, OTHER_ADDRESS } from './testing';

type Call = { url: string; headers: Record<string, string>; body: string };
const msg = { to: 'owner@example.com', subject: 'Hello', text: 'Body' };

void describe('Oqumail mailer', () => {
  void it('posts to the documented endpoint with a Bearer key and a JSON body', async () => {
    const calls: Call[] = [];
    const mailer = createOqumailMailer({
      apiKey: 'oqu_test_key', fetchImpl: (url, init) => { calls.push({ url, headers: init.headers, body: init.body }); return Promise.resolve({ status: 202 }); },
    });
    await mailer.send(msg);
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.url, 'https://api.oqumail.com/api/v1/emails');
    assert.equal(calls[0]?.headers.authorization, 'Bearer oqu_test_key');
    assert.deepEqual(JSON.parse(calls[0]?.body ?? '{}'), { to: msg.to, subject: msg.subject, text: msg.text });
  });

  void it('never sends a From address: the sender is configured in Oqumail', async () => {
    const calls: Call[] = [];
    const mailer = createOqumailMailer({ apiKey: 'k12345678', fetchImpl: (url, init) => { calls.push({ url, headers: init.headers, body: init.body }); return Promise.resolve({ status: 202 }); } });
    await mailer.send(msg);
    assert.ok(!('from' in (JSON.parse(calls[0]?.body ?? '{}') as object)));
  });

  void it('retries 429 and 5xx with backoff but never 4xx', async () => {
    const statuses = [503, 429, 202];
    const sleeps: number[] = [];
    const mailer = createOqumailMailer({
      apiKey: 'k12345678', sleep: (ms) => { sleeps.push(ms); return Promise.resolve(); },
      fetchImpl: () => Promise.resolve({ status: statuses.shift() ?? 500 }),
    });
    await mailer.send(msg);
    assert.equal(sleeps.length, 2);

    let calls = 0;
    const unauthorized = createOqumailMailer({ apiKey: 'k12345678', sleep: () => Promise.resolve(), fetchImpl: () => { calls += 1; return Promise.resolve({ status: 401 }); } });
    await assert.rejects(unauthorized.send(msg), /status 401/);
    assert.equal(calls, 1);
  });

  void it('gives up after three attempts on persistent failure', async () => {
    let calls = 0;
    const mailer = createOqumailMailer({ apiKey: 'k12345678', sleep: () => Promise.resolve(), fetchImpl: () => { calls += 1; return Promise.reject(new Error('boom')); } });
    await assert.rejects(mailer.send(msg), /network error/);
    assert.equal(calls, 3);
  });
});

void describe('email provider selection', () => {
  const base = { NODE_ENV: 'test', DATABASE_URL: 'postgres://u:p@localhost:5432/d', GOOGLE_CLIENT_ID: 'c', GOOGLE_CLIENT_SECRET: 's', GOOGLE_REDIRECT_URI: 'http://localhost/cb',
    SESSION_SECRET: 's'.repeat(32), API_KEY_PEPPER: 'p'.repeat(32), WEBHOOK_SECRET_ENCRYPTION_KEY: 'ab'.repeat(32) };
  const load = (extra: Record<string, string>) => loadApiConfig({ ...base, ...extra });

  void it('enables payout changes with only the Oqumail key', () => {
    const c = load({ OQUMAIL_API_KEY: 'oqu_test_key' });
    assert.equal(c.emailProvider, 'oqumail');
    assert.equal(c.payoutChangesEnabled, true);
    assert.ok(createMailer(c));
  });
  void it('also works when EMAIL_PROVIDER=oqumail is set explicitly, and ignores EMAIL_FROM', () => {
    assert.equal(load({ EMAIL_PROVIDER: 'oqumail', OQUMAIL_API_KEY: 'oqu_test_key', EMAIL_FROM: 'x@example.test' }).emailProvider, 'oqumail');
  });
  void it('stays disabled without a key, and SMTP still needs full credentials', () => {
    assert.equal(load({}).payoutChangesEnabled, false);
    assert.equal(createMailer(load({})), null);
    assert.equal(load({ EMAIL_PROVIDER: 'smtp', SMTP_HOST: 'h', SMTP_PORT: '587', SMTP_USER: 'u', SMTP_PASSWORD: 'p' }).payoutChangesEnabled, false);
    assert.equal(load({ EMAIL_PROVIDER: 'smtp', SMTP_HOST: 'h', SMTP_PORT: '587', SMTP_USER: 'u', SMTP_PASSWORD: 'p', EMAIL_FROM: 'a@example.test' }).emailProvider, 'smtp');
  });
});

void describe('payout change when the email send fails', () => {
  void it('cancels the token and keeps the payout address', async () => {
    const h = await makeHarness();
    try {
      h.deps.mailer = { send: () => Promise.reject(new Error('down')) };
      const { session } = await h.onboard('mail-fail');
      const res = await h.call('POST', '/v1/merchant/payout-address/change', { session, body: { new_address: OTHER_ADDRESS } });
      assert.equal(res.status, 503);
      assert.equal((res.body.error as { code: string }).code, 'email_send_failed');
      assert.equal((await h.db`SELECT status FROM payout_address_changes`)[0]?.status, 'cancelled');
      assert.equal((await h.call('GET', '/v1/merchant', { session })).body.payout_address, MERCHANT_ADDRESS);
    } finally {
      await h.close();
    }
  });
});
