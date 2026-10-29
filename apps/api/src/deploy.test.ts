import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { Hono } from 'hono';
import { loadApiConfig } from '@acqui/shared';
import { clientIp, cookieOptions } from './http';
import { makeHarness, ORIGIN, type Harness } from './testing';

const SECRET = 'p'.repeat(40);
const ipOf = async (headers: Record<string, string>, trust: boolean, secret?: string): Promise<string> => {
  const app = new Hono();
  app.get('/ip', (c) => c.text(clientIp(c, trust, secret)));
  const res = await app.request('/ip', { headers });
  return res.text();
};

void describe('client address for rate limits', () => {
  void it('trusts only the last forwarded entry, which the platform proxy appended', async () => {
    assert.equal(await ipOf({ 'x-forwarded-for': '6.6.6.6, 203.0.113.9' }, true), '203.0.113.9');
    assert.equal(await ipOf({ 'x-forwarded-for': '203.0.113.9' }, true), '203.0.113.9');
    assert.equal(await ipOf({ 'x-forwarded-for': '6.6.6.6' }, false), 'unknown');
  });

  void it('accepts the edge function address only with the shared secret', async () => {
    const edge = { 'x-acqui-client-ip': '198.51.100.7', 'x-acqui-proxy-secret': SECRET, 'x-forwarded-for': '10.0.0.1' };
    assert.equal(await ipOf(edge, true, SECRET), '198.51.100.7');
    assert.equal(await ipOf({ ...edge, 'x-acqui-proxy-secret': 'q'.repeat(40) }, true, SECRET), '10.0.0.1');
    assert.equal(await ipOf(edge, true, undefined), '10.0.0.1');
    assert.equal(await ipOf({ 'x-acqui-client-ip': '198.51.100.7' }, true, SECRET), 'unknown');
  });
});

void describe('deployment settings', () => {
  const base = { DATABASE_URL: 'postgres://u:p@localhost:5432/d', GOOGLE_CLIENT_ID: 'c', GOOGLE_CLIENT_SECRET: 's', GOOGLE_REDIRECT_URI: 'https://acqui.pages.dev/api/auth/google/callback',
    SESSION_SECRET: 's'.repeat(32), API_KEY_PEPPER: 'p'.repeat(32), WEBHOOK_SECRET_ENCRYPTION_KEY: 'ab'.repeat(32) };

  void it('parses extra CORS origins and rejects entries with a path', () => {
    const ok = loadApiConfig({ ...base, NODE_ENV: 'test', CORS_ALLOWED_ORIGINS: 'https://a.pages.dev, https://b.example.com' });
    assert.deepEqual(ok.CORS_ALLOWED_ORIGINS, ['https://a.pages.dev', 'https://b.example.com']);
    assert.throws(() => loadApiConfig({ ...base, NODE_ENV: 'test', CORS_ALLOWED_ORIGINS: 'https://a.pages.dev/app' }), /CORS_ALLOWED_ORIGINS/);
  });

  void it('allows SameSite=None cookies only in production, where they are Secure', () => {
    assert.throws(() => loadApiConfig({ ...base, NODE_ENV: 'development', COOKIE_SAME_SITE: 'none' }), /COOKIE_SAME_SITE/);
    const prod = loadApiConfig({ ...base, NODE_ENV: 'production', ARC_RPC_URL: 'https://rpc.example.com', COOKIE_SAME_SITE: 'none' });
    assert.equal(prod.COOKIE_SAME_SITE, 'none');
    assert.equal(loadApiConfig({ ...base, NODE_ENV: 'test' }).COOKIE_SAME_SITE, 'lax');
    assert.deepEqual(cookieOptions(true, 60, '/', 'None'), { httpOnly: true, secure: true, sameSite: 'None', path: '/', maxAge: 60 });
    assert.equal(cookieOptions(true, 60).sameSite, 'Lax');
  });
});

void describe('API behind a separate website origin', () => {
  let h: Harness;
  afterEach(async () => h.close());
  const PREVIEW = 'https://preview-1.acqui.pages.dev';

  void it('answers CORS preflights for the website, extra origins and nobody else', async () => {
    h = await makeHarness({ env: { CORS_ALLOWED_ORIGINS: PREVIEW } });
    const pre = (origin: string) => h.call('OPTIONS', '/v1/merchant', { headers: { origin, 'access-control-request-method': 'PATCH', 'access-control-request-headers': 'content-type,x-csrf-token' } });
    for (const origin of [ORIGIN, PREVIEW]) {
      const res = await pre(origin);
      assert.equal(res.headers.get('access-control-allow-origin'), origin);
      assert.equal(res.headers.get('access-control-allow-credentials'), 'true');
      assert.match(res.headers.get('access-control-allow-headers') ?? '', /x-csrf-token/);
    }
    assert.equal((await pre('https://evil.example')).headers.get('access-control-allow-origin'), null);
  });

  void it('accepts session writes from a configured extra origin and refuses others', async () => {
    h = await makeHarness({ env: { CORS_ALLOWED_ORIGINS: PREVIEW } });
    const { session } = await h.onboard('cors-owner');
    const patch = (origin: string) => h.call('PATCH', '/v1/merchant', { session, origin, body: { display_name: 'Renamed shop' } });
    assert.equal((await patch(PREVIEW)).status, 200);
    assert.equal((await patch('https://evil.example')).status, 403);
  });

  void it('reports readiness from the database and liveness without it', async () => {
    h = await makeHarness();
    assert.equal((await h.call('GET', '/ready')).status, 200);
    assert.equal((await h.call('GET', '/health')).status, 200);
    await h.db.end();
    assert.equal((await h.call('GET', '/ready')).status, 503);
    assert.equal((await h.call('GET', '/health')).status, 200);
  });
});
