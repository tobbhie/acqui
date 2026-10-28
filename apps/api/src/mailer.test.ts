import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createOqumailMailer } from './mailer';
import { makeHarness, MERCHANT_ADDRESS, OTHER_ADDRESS } from './testing';

type Call = { url: string; headers: Record<string, string>; body: string };
const msg = { to: 'owner@example.com', subject: 'Hello', text: 'Body' };

void describe('Oqumail mailer', () => {
  void it('posts to the documented endpoint with a Bearer key and a JSON body', async () => {
    const calls: Call[] = [];
    const mailer = createOqumailMailer({
      apiKey: 'oqu_test_key', from: 'noreply@shop.example',
      fetchImpl: (url, init) => { calls.push({ url, headers: init.headers, body: init.body }); return Promise.resolve({ status: 202 }); },
    });
    await mailer.send(msg);
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.url, 'https://api.oqumail.com/api/v1/emails');
    assert.equal(calls[0]?.headers.authorization, 'Bearer oqu_test_key');
    assert.deepEqual(JSON.parse(calls[0]?.body ?? '{}'), { from: 'noreply@shop.example', to: msg.to, subject: msg.subject, text: msg.text });
  });

  void it('retries 429 and 5xx with backoff but never 4xx', async () => {
    const statuses = [503, 429, 202];
    const sleeps: number[] = [];
    const mailer = createOqumailMailer({
      apiKey: 'k12345678', from: 'a@b.example', sleep: (ms) => { sleeps.push(ms); return Promise.resolve(); },
      fetchImpl: () => Promise.resolve({ status: statuses.shift() ?? 500 }),
    });
    await mailer.send(msg);
    assert.equal(sleeps.length, 2);

    let calls = 0;
    const unauthorized = createOqumailMailer({ apiKey: 'k12345678', from: 'a@b.example', sleep: () => Promise.resolve(), fetchImpl: () => { calls += 1; return Promise.resolve({ status: 401 }); } });
    await assert.rejects(unauthorized.send(msg), /status 401/);
    assert.equal(calls, 1);
  });

  void it('gives up after three attempts on persistent failure', async () => {
    let calls = 0;
    const mailer = createOqumailMailer({ apiKey: 'k12345678', from: 'a@b.example', sleep: () => Promise.resolve(), fetchImpl: () => { calls += 1; return Promise.reject(new Error('boom')); } });
    await assert.rejects(mailer.send(msg), /network error/);
    assert.equal(calls, 3);
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
