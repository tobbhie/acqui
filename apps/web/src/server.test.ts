import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { before, describe, it } from 'node:test';
import { createWebApp, edgeClientIp } from './server';

interface Seen { url: string; method: string; headers: Headers; body: string }

void describe('web server', () => {
  let dist = '';
  before(() => {
    dist = mkdtempSync(join(tmpdir(), 'acqui-dist-'));
    mkdirSync(join(dist, 'assets'));
    writeFileSync(join(dist, 'index.html'), '<!doctype html><div id="root">acqui-spa</div>');
    writeFileSync(join(dist, 'assets', 'app-abc123.js'), 'console.log(1)');
  });

  const seen: Seen[] = [];
  let reply: () => Promise<Response> = () => Promise.resolve(Response.json({ ok: true }));
  const make = () => createWebApp({
    distDir: dist,
    apiBaseUrl: 'http://api.internal:8080/',
    fetchImpl: async (url, init) => {
      seen.push({ url, method: init.method ?? 'GET', headers: new Headers(init.headers), body: init.body ? await new Response(init.body).text() : '' });
      return reply();
    },
  });

  void it('serves the app, falls back to it for client routes, and caches hashed assets forever', async () => {
    const app = make();
    for (const path of ['/', '/demo', '/merchants', '/pay/AbCdEfGhIjKlMnOpQrStUv', '/demo/order/00000000-0000-4000-8000-000000000000']) {
      const res = await app.request(path);
      assert.equal(res.status, 200, path);
      assert.ok((await res.text()).includes('acqui-spa'), path);
      assert.equal(res.headers.get('cache-control'), 'no-cache', path);
    }
    const asset = await app.request('/assets/app-abc123.js');
    assert.equal(asset.status, 200);
    assert.match(asset.headers.get('cache-control') ?? '', /immutable/);
  });

  void it('forbids framing, so a hidden frame cannot trick a customer on checkout', async () => {
    const res = await make().request('/pay/AbCdEfGhIjKlMnOpQrStUv');
    assert.equal(res.headers.get('x-frame-options'), 'DENY');
    assert.match(res.headers.get('content-security-policy') ?? '', /frame-ancestors 'none'/);
  });

  void it('answers its own health check without touching the API', async () => {
    seen.length = 0;
    const res = await make().request('/health');
    assert.equal(res.status, 200);
    assert.equal(seen.length, 0);
  });

  void it('forwards /api/* to the API with the prefix removed and keeps the query', async () => {
    seen.length = 0;
    reply = () => Promise.resolve(Response.json({ network: 'arc-testnet' }));
    const res = await make().request('/api/public/payments/abc/status?x=1');
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { network: 'arc-testnet' });
    assert.equal(seen[0]?.url, 'http://api.internal:8080/public/payments/abc/status?x=1');
  });

  void it('passes redirects and several Set-Cookie headers through untouched (Google sign-in)', async () => {
    reply = () => {
      const headers = new Headers({ location: 'https://accounts.google.com/o/oauth2/v2/auth?state=s' });
      headers.append('set-cookie', 'acqui_oauth_state=s; HttpOnly; Path=/');
      headers.append('set-cookie', 'acqui_session=t; HttpOnly; Path=/');
      return Promise.resolve(new Response(null, { status: 302, headers }));
    };
    const res = await make().request('/api/auth/google/start');
    assert.equal(res.status, 302);
    assert.match(res.headers.get('location') ?? '', /^https:\/\/accounts\.google\.com\//);
    assert.equal(res.headers.getSetCookie().length, 2);
  });

  void it('forwards method, body, cookies and credentials but never the Host header, and trusts only the edge IP', async () => {
    seen.length = 0;
    reply = () => Promise.resolve(Response.json({ ok: true }, { status: 201 }));
    const res = await make().request('/api/v1/payment-intents', {
      method: 'POST',
      headers: {
        host: 'acqui.example', cookie: 'acqui_session=t', 'x-csrf-token': 'c', authorization: 'Bearer k', 'idempotency-key': 'i1',
        'content-type': 'application/json', 'x-forwarded-for': '6.6.6.6, 203.0.113.9',
      },
      body: JSON.stringify({ amount: '1.00' }),
    });
    assert.equal(res.status, 201);
    const s = seen[0];
    assert.equal(s?.method, 'POST');
    assert.equal(s?.body, '{"amount":"1.00"}');
    assert.equal(s?.headers.get('cookie'), 'acqui_session=t');
    assert.equal(s?.headers.get('authorization'), 'Bearer k');
    assert.equal(s?.headers.get('x-csrf-token'), 'c');
    assert.equal(s?.headers.get('x-forwarded-for'), '203.0.113.9');
    assert.equal(s?.headers.get('x-forwarded-host'), 'acqui.example');
    assert.notEqual(s?.headers.get('host'), 'acqui.example');
  });

  void it('returns a clear 502 when the API is down, never the app shell', async () => {
    reply = () => Promise.reject(new Error('connect ECONNREFUSED'));
    const res = await make().request('/api/public/config');
    assert.equal(res.status, 502);
    assert.equal(((await res.json()) as { error: { code: string } }).error.code, 'upstream_unavailable');
  });

  void it('lets API errors through as they are and does not turn unknown API paths into the app', async () => {
    reply = () => Promise.resolve(Response.json({ error: { code: 'not_found' } }, { status: 404 }));
    const res = await make().request('/api/nope');
    assert.equal(res.status, 404);
    assert.ok(!(await res.text()).includes('acqui-spa'));
  });

  void it('does not read files outside the build directory', async () => {
    const res = await make().request('/..%2f..%2f..%2fetc%2fpasswd');
    assert.ok(!(await res.text()).includes('root:'));
  });

  void it('takes the last X-Forwarded-For entry', () => {
    assert.equal(edgeClientIp('1.1.1.1, 2.2.2.2, 3.3.3.3'), '3.3.3.3');
    assert.equal(edgeClientIp('9.9.9.9'), '9.9.9.9');
    assert.equal(edgeClientIp(undefined), undefined);
    assert.equal(edgeClientIp(' , '), undefined);
  });
});
