import { Hono } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import type { AppDeps, HonoEnv } from '../context';
import { cookieNames, cookieOptions, clearSessionCookie, requireSession, setSessionCookie } from '../http';
import { OAUTH_FLOW_TTL_MS, SESSION_TTL_MS, consumeOAuthFlow, createSession, revokeSession, saveOAuthFlow, upsertUser } from '../auth/session';
import { getMerchantByUser } from '../merchants';
import { safeEqualStrings } from '../lib/crypto';
import type { FixedWindowLimiter } from '../lib/rate-limit';
import { rateLimit } from '../lib/rate-limit';
import { clientIp } from '../http';

export function authRoutes(deps: AppDeps, authLimiter: FixedWindowLimiter): Hono<HonoEnv> {
  const app = new Hono<HonoEnv>();
  const production = deps.config.NODE_ENV === 'production';
  const names = cookieNames(production);
  const dashboard = (deps.config.DASHBOARD_BASE_URL ?? deps.config.CHECKOUT_BASE_URL).replace(/\/+$/, '');
  const limit = rateLimit(authLimiter, (c) => `auth:${clientIp(c, deps.config.TRUST_PROXY === 'true')}`);

  app.get('/google/start', limit, async (c) => {
    const { url, flow } = await deps.googleAuth.createAuthorization();
    await saveOAuthFlow(deps.db, flow, deps.now());
    // Binds the flow to this browser: the callback must present the same state in a cookie (login CSRF defence).
    setCookie(c, names.oauth, flow.state, cookieOptions(production, OAUTH_FLOW_TTL_MS / 1000, '/'));
    return c.redirect(url, 302);
  });

  app.get('/google/callback', limit, async (c) => {
    const fail = () => {
      deleteCookie(c, names.oauth, { path: '/', secure: production });
      return c.redirect(`${dashboard}/dashboard?error=login_failed`, 302);
    };
    const state = c.req.query('state');
    const cookieState = getCookie(c, names.oauth);
    if (!state || !cookieState || !safeEqualStrings(state, cookieState)) return fail();
    const flow = await consumeOAuthFlow(deps.db, state, deps.now());
    if (!flow) return fail();
    try {
      const profile = await deps.googleAuth.exchange(new URL(c.req.url), flow);
      if (!profile.emailVerified) return fail();
      const userId = await upsertUser(deps.db, { sub: profile.sub, email: profile.email, name: profile.name });
      const session = await createSession(deps.db, userId, deps.now());
      setSessionCookie(deps, c, session.token, SESSION_TTL_MS / 1000);
      deleteCookie(c, names.oauth, { path: '/', secure: production });
      return c.redirect(`${dashboard}/dashboard`, 302);
    } catch {
      return fail();
    }
  });

  app.get('/session', requireSession(deps), async (c) => {
    const session = c.get('session');
    const merchant = await getMerchantByUser(deps.db, session.userId);
    return c.json({
      user: { email: session.email, name: session.name },
      csrf_token: session.csrfToken,
      merchant: merchant ? { merchant_id: merchant.id, display_name: merchant.display_name } : null,
    });
  });

  app.post('/logout', requireSession(deps), async (c) => {
    await revokeSession(deps.db, c.get('session').sessionId);
    clearSessionCookie(deps, c);
    return c.json({ ok: true });
  });

  return app;
}
