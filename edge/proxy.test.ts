import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseApiOrigin, proxyToApi } from './proxy';

interface Seen { url: string; method: string; headers: Headers; body: string }
const ENV = { API_ORIGIN: 'https://api--acqui.code.run', PROXY_SHARED_SECRET: 's'.repeat(40) };

function harness(reply: () => Promise<Response> = () => Promise.resolve(Response.json({ ok: true }))) {
  const seen: Seen[] = [];
  const doFetch = async (url: string, init: RequestInit): Promise<Response> => {
    seen.push({ url, method: init.method ?? 'GET', headers: new Headers(init.headers), body: init.body ? await new Response(init.body as BodyInit).text() : '' });
    return reply();
  };
  return { seen, run: (req: Request, env = ENV) => proxyToApi(req, env, doFetch) };
}

void describe('Cloudflare Pages API proxy', () => {
  void it('forwards to the API origin with the /api prefix removed and the query kept', async () => {
    const h = harness();
    const res = await h.run(new Request('https://acqui.pages.dev/api/public/payments/abc/status?x=1'));
    assert.equal(res.status, 200);
    assert.equal(h.seen[0]?.url, 'https://api--acqui.code.run/public/payments/abc/status?x=1');
  });

  void it('refuses to run without a valid HTTPS API origin', async () => {
    for (const bad of [undefined, '', 'http://api.example.com', 'https://api.example.com/v1', 'https://user:pw@api.example.com', 'not a url']) {
      const h = harness();
      const res = await h.run(new Request('https://acqui.pages.dev/api/health'), { API_ORIGIN: bad } as typeof ENV);
      assert.equal(res.status, 500, String(bad));
      assert.equal(h.seen.length, 0);
    }
    assert.equal(parseApiOrigin('http://localhost:8080'), 'http://localhost:8080');
    assert.equal(parseApiOrigin('https://api.example.com/'), 'https://api.example.com');
  });

  void it('passes sign-in redirects and several Set-Cookie headers through untouched', async () => {
    const h = harness(() => {
      const headers = new Headers({ location: 'https://accounts.google.com/o/oauth2/v2/auth?state=s' });
      headers.append('set-cookie', 'acqui_oauth_state=s; HttpOnly; Path=/');
      headers.append('set-cookie', 'acqui_session=t; HttpOnly; Path=/');
      return Promise.resolve(new Response(null, { status: 302, headers }));
    });
    const res = await h.run(new Request('https://acqui.pages.dev/api/auth/google/start'));
    assert.equal(res.status, 302);
    assert.match(res.headers.get('location') ?? '', /^https:\/\/accounts\.google\.com\//);
    assert.equal(res.headers.getSetCookie().length, 2);
  });

  void it('forwards credentials, method and body, and tells the API the visitor address only with the shared secret', async () => {
    const h = harness(() => Promise.resolve(Response.json({ ok: true }, { status: 201 })));
    const res = await h.run(new Request('https://acqui.pages.dev/api/v1/payment-intents', {
      method: 'POST',
      headers: {
        cookie: 'acqui_session=t', 'x-csrf-token': 'c', authorization: 'Bearer k', 'idempotency-key': 'i1', origin: 'https://acqui.pages.dev',
        'content-type': 'application/json', 'cf-connecting-ip': '203.0.113.9', 'x-forwarded-for': '6.6.6.6',
      },
      body: JSON.stringify({ amount: '1.00' }),
    }));
    assert.equal(res.status, 201);
    const s = h.seen[0];
    assert.equal(s?.method, 'POST');
    assert.equal(s?.body, '{"amount":"1.00"}');
    for (const [k, v] of [['cookie', 'acqui_session=t'], ['x-csrf-token', 'c'], ['authorization', 'Bearer k'], ['idempotency-key', 'i1'], ['origin', 'https://acqui.pages.dev']] as const) {
      assert.equal(s?.headers.get(k), v, k);
    }
    assert.equal(s?.headers.get('x-acqui-client-ip'), '203.0.113.9');
    assert.equal(s?.headers.get('x-acqui-proxy-secret'), ENV.PROXY_SHARED_SECRET);
    assert.equal(s?.headers.get('x-forwarded-for'), null, 'a caller-supplied forwarded-for is never passed on');
    assert.equal(s?.headers.get('x-forwarded-host'), 'acqui.pages.dev');
    assert.equal(s?.headers.get('accept-encoding'), 'identity');
    assert.equal(s?.headers.get('cf-connecting-ip'), null);
  });

  void it('never lets a caller impersonate the edge, and sends no secret when none is configured', async () => {
    const h = harness();
    await h.run(new Request('https://acqui.pages.dev/api/health', { headers: { 'x-acqui-client-ip': '1.1.1.1', 'x-acqui-proxy-secret': 'guess', 'cf-connecting-ip': '203.0.113.9' } }), { API_ORIGIN: ENV.API_ORIGIN } as typeof ENV);
    const s = h.seen[0];
    assert.equal(s?.headers.get('x-acqui-client-ip'), null);
    assert.equal(s?.headers.get('x-acqui-proxy-secret'), null);
  });

  void it('returns a clear 502 when the API is down', async () => {
    const h = harness(() => Promise.reject(new Error('connect ECONNREFUSED')));
    const res = await h.run(new Request('https://acqui.pages.dev/api/public/config'));
    assert.equal(res.status, 502);
    assert.equal(((await res.json()) as { error: { code: string } }).error.code, 'upstream_unavailable');
  });

  void it('passes API errors through unchanged', async () => {
    const h = harness(() => Promise.resolve(Response.json({ error: { code: 'not_found' } }, { status: 404 })));
    const res = await h.run(new Request('https://acqui.pages.dev/api/nope'));
    assert.equal(res.status, 404);
  });
});
