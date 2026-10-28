// arc-studio-allow-onchain-literal
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { makeHarness, ORIGIN, type Harness } from './testing';

let h: Harness;
void before(async () => { h = await makeHarness(); });
void after(async () => { await h.close(); });

void describe('Google OAuth sessions', () => {
  void it('logs in through the OAuth callback and sets an HttpOnly SameSite session cookie', async () => {
    h.profiles.set('sub-a', { sub: 'sub-a', email: 'a@example.com', emailVerified: true, name: 'A' });
    const start = await h.app.request('/auth/google/start');
    assert.equal(start.status, 302);
    const state = new URL(start.headers.get('location') ?? '').searchParams.get('state') ?? '';
    const oauthCookie = start.headers.getSetCookie().find((c) => c.startsWith('acqui_oauth_state=')) ?? '';
    assert.match(oauthCookie, /HttpOnly/i);
    assert.match(oauthCookie, /SameSite=Lax/i);
    const cb = await h.app.request(`/auth/google/callback?state=${state}&code=sub-a`, { headers: { cookie: oauthCookie.split(';')[0] ?? '' } });
    assert.equal(cb.status, 302);
    assert.equal(cb.headers.get('location'), `${ORIGIN}/dashboard`);
    const session = cb.headers.getSetCookie().find((c) => c.startsWith('acqui_session=')) ?? '';
    assert.match(session, /HttpOnly/i);
    assert.match(session, /SameSite=Lax/i);
    const rows = await h.db`SELECT email, google_sub FROM users`;
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.google_sub, 'sub-a');
  });

  void it('stores only a hash of the session token', async () => {
    const s = await h.login('sub-hash');
    const token = s.cookie.split('=')[1] ?? '';
    const rows = await h.db`SELECT token_hash FROM sessions`;
    assert.ok(rows.length > 0);
    assert.ok(rows.every((r) => !(r.token_hash as Buffer).toString('utf8').includes(token)));
  });

  void it('rejects a callback whose state cookie does not match (login CSRF)', async () => {
    h.profiles.set('sub-b', { sub: 'sub-b', email: 'b@example.com', emailVerified: true, name: 'B' });
    const start = await h.app.request('/auth/google/start');
    const state = new URL(start.headers.get('location') ?? '').searchParams.get('state') ?? '';
    const cb = await h.app.request(`/auth/google/callback?state=${state}&code=sub-b`, { headers: { cookie: 'acqui_oauth_state=attacker' } });
    assert.match(cb.headers.get('location') ?? '', /error=login_failed/);
    assert.equal(cb.headers.getSetCookie().some((c) => c.startsWith('acqui_session=')), false);
  });

  void it('consumes the flow so a callback URL cannot be replayed', async () => {
    h.profiles.set('sub-c', { sub: 'sub-c', email: 'c@example.com', emailVerified: true, name: 'C' });
    const start = await h.app.request('/auth/google/start');
    const state = new URL(start.headers.get('location') ?? '').searchParams.get('state') ?? '';
    const cookie = (start.headers.getSetCookie().find((c) => c.startsWith('acqui_oauth_state=')) ?? '').split(';')[0] ?? '';
    const first = await h.app.request(`/auth/google/callback?state=${state}&code=sub-c`, { headers: { cookie } });
    assert.ok(first.headers.getSetCookie().some((c) => c.startsWith('acqui_session=')));
    const second = await h.app.request(`/auth/google/callback?state=${state}&code=sub-c`, { headers: { cookie } });
    assert.match(second.headers.get('location') ?? '', /error=login_failed/);
  });

  void it('refuses an unverified Google email', async () => {
    h.profiles.set('sub-d', { sub: 'sub-d', email: 'd@example.com', emailVerified: false, name: 'D' });
    const start = await h.app.request('/auth/google/start');
    const state = new URL(start.headers.get('location') ?? '').searchParams.get('state') ?? '';
    const cookie = (start.headers.getSetCookie().find((c) => c.startsWith('acqui_oauth_state=')) ?? '').split(';')[0] ?? '';
    const cb = await h.app.request(`/auth/google/callback?state=${state}&code=sub-d`, { headers: { cookie } });
    assert.match(cb.headers.get('location') ?? '', /error=login_failed/);
    assert.equal((await h.db`SELECT 1 FROM users WHERE google_sub = 'sub-d'`).length, 0);
  });

  void it('expires an old flow', async () => {
    h.profiles.set('sub-e', { sub: 'sub-e', email: 'e@example.com', emailVerified: true, name: 'E' });
    const start = await h.app.request('/auth/google/start');
    const state = new URL(start.headers.get('location') ?? '').searchParams.get('state') ?? '';
    const cookie = (start.headers.getSetCookie().find((c) => c.startsWith('acqui_oauth_state=')) ?? '').split(';')[0] ?? '';
    h.clock.advance(11 * 60 * 1000);
    const cb = await h.app.request(`/auth/google/callback?state=${state}&code=sub-e`, { headers: { cookie } });
    assert.match(cb.headers.get('location') ?? '', /error=login_failed/);
  });
});

void describe('CSRF and session guards', () => {
  void it('401 without a session', async () => {
    assert.equal((await h.call('GET', '/v1/merchant')).status, 401);
  });

  void it('rejects state-changing requests without the CSRF header', async () => {
    const session = await h.login('csrf-1');
    const res = await h.call('POST', '/v1/merchant', { session, csrf: false, body: { display_name: 'Shop' } });
    assert.equal(res.status, 403);
    assert.equal((res.body.error as { code: string }).code, 'csrf_failed');
  });

  void it('rejects a wrong CSRF token and a foreign Origin', async () => {
    const session = await h.login('csrf-2');
    const wrong = await h.call('POST', '/v1/merchant', { session: { ...session, csrf: 'nope' }, body: { display_name: 'Shop' } });
    assert.equal(wrong.status, 403);
    const foreign = await h.call('POST', '/v1/merchant', { session, origin: 'https://evil.example', body: { display_name: 'Shop' } });
    assert.equal((foreign.body.error as { code: string }).code, 'bad_origin');
    const none = await h.call('POST', '/v1/merchant', { session, origin: null, body: { display_name: 'Shop' } });
    assert.equal(none.status, 403);
  });

  void it('logout revokes the session server side', async () => {
    const session = await h.login('logout-1');
    assert.equal((await h.call('POST', '/auth/logout', { session })).status, 200);
    assert.equal((await h.call('GET', '/auth/session', { session })).status, 401);
  });

  void it('expires sessions after seven days', async () => {
    const session = await h.login('exp-1');
    assert.equal((await h.call('GET', '/auth/session', { session })).status, 200);
    h.clock.advance(8 * 24 * 60 * 60 * 1000);
    assert.equal((await h.call('GET', '/auth/session', { session })).status, 401);
  });
});
