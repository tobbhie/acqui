import { getConnInfo } from '@hono/node-server/conninfo';
import type { Context, MiddlewareHandler } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import type { z } from 'zod';
import { getMerchantById, getMerchantByUser } from './merchants';
import { authenticateApiKey } from './apiKeys';
import { loadSession } from './auth/session';
import type { AppDeps, HonoEnv } from './context';
import { conflict, forbidden, unauthorized, unprocessable, badRequest } from './lib/errors';
import { safeEqualStrings, sha256 } from './lib/crypto';

export const MAX_BODY_BYTES = 16 * 1024;
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export const cookieNames = (production: boolean) => ({
  session: production ? '__Host-acqui_session' : 'acqui_session',
  oauth: 'acqui_oauth_state',
});

export function cookieOptions(production: boolean, maxAgeSeconds: number, path = '/') {
  return { httpOnly: true, secure: production, sameSite: 'Lax' as const, path, maxAge: maxAgeSeconds };
}

export function clientIp(c: Context, trustProxy: boolean): string {
  if (trustProxy) {
    const forwarded = c.req.header('x-forwarded-for')?.split(',')[0]?.trim();
    if (forwarded) return forwarded;
  }
  try {
    return getConnInfo(c).remote.address ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

/** Strict JSON body: size capped, JSON content type required, schema validated. */
export async function parseBody<S extends z.ZodTypeAny>(c: Context, schema: S): Promise<z.infer<S>> {
  if (!(c.req.header('content-type') ?? '').toLowerCase().startsWith('application/json')) {
    throw badRequest('invalid_content_type', 'Content-Type must be application/json');
  }
  const text = await c.req.text();
  if (Buffer.byteLength(text) > MAX_BODY_BYTES) throw badRequest('body_too_large', 'Request body too large');
  let json: unknown;
  try {
    json = text.length === 0 ? {} : JSON.parse(text);
  } catch {
    throw badRequest('invalid_json', 'Body is not valid JSON');
  }
  return validate(schema, json);
}

export function validate<S extends z.ZodTypeAny>(schema: S, value: unknown): z.infer<S> {
  const result = schema.safeParse(value);
  if (!result.success) {
    const issue = result.error.issues[0];
    const path = issue?.path.join('.') || 'body';
    throw unprocessable('invalid_request', `${path}: ${issue?.message ?? 'invalid'}`);
  }
  return result.data as z.infer<S>;
}

function allowedOrigins(deps: AppDeps): Set<string> {
  const origins = new Set<string>();
  for (const url of [deps.config.DASHBOARD_BASE_URL, deps.config.CHECKOUT_BASE_URL]) {
    if (url) origins.add(new URL(url).origin);
  }
  return origins;
}

/** Cookie sessions: HttpOnly cookie plus, on state-changing requests, a matching CSRF header and an allowed Origin. */
export function requireSession(deps: AppDeps): MiddlewareHandler<HonoEnv> {
  const names = cookieNames(deps.config.NODE_ENV === 'production');
  const origins = allowedOrigins(deps);
  return async (c, next) => {
    await authenticateSession(deps, c, names.session, origins);
    c.set('authKind', 'session');
    await next();
  };
}

async function authenticateSession(deps: AppDeps, c: Context<HonoEnv>, cookieName: string, origins: Set<string>): Promise<void> {
  const token = getCookie(c, cookieName);
  const session = token ? await loadSession(deps.db, token, deps.now()) : null;
  if (!session) throw unauthorized();
  if (!SAFE_METHODS.has(c.req.method)) {
    const origin = c.req.header('origin');
    if (!origin || !origins.has(origin)) throw forbidden('bad_origin', 'Request origin is not allowed');
    const csrf = c.req.header('x-csrf-token');
    if (!csrf || !safeEqualStrings(csrf, session.csrfToken)) throw forbidden('csrf_failed', 'Missing or invalid CSRF token');
  }
  c.set('session', session);
}

export function clearSessionCookie(deps: AppDeps, c: Context): void {
  const production = deps.config.NODE_ENV === 'production';
  deleteCookie(c, cookieNames(production).session, { path: '/', secure: production });
}

export function setSessionCookie(deps: AppDeps, c: Context, token: string, maxAgeSeconds: number): void {
  const production = deps.config.NODE_ENV === 'production';
  setCookie(c, cookieNames(production).session, token, cookieOptions(production, maxAgeSeconds));
}

/** Loads the merchant of the signed-in user. */
export function requireMerchantSession(deps: AppDeps): MiddlewareHandler<HonoEnv> {
  return async (c, next) => {
    const session = c.get('session');
    const merchant = await getMerchantByUser(deps.db, session.userId);
    if (!merchant) throw conflict('merchant_required', 'Create a merchant first');
    c.set('merchant', merchant);
    await next();
  };
}

/** Accepts `Authorization: Bearer aq_live_...` (server-to-server) or a dashboard session. Keys never touch cookies. */
export function requireMerchantAuth(deps: AppDeps): MiddlewareHandler<HonoEnv> {
  const names = cookieNames(deps.config.NODE_ENV === 'production');
  const origins = allowedOrigins(deps);
  return async (c, next) => {
    const header = c.req.header('authorization');
    if (header) {
      const m = /^Bearer (\S+)$/i.exec(header);
      const found = m?.[1] ? await authenticateApiKey(deps.db, m[1], deps.config.API_KEY_PEPPER, deps.now()) : null;
      if (!found) throw unauthorized('Invalid API key');
      const merchant = await getMerchantById(deps.db, found.merchantId);
      if (!merchant) throw unauthorized('Invalid API key');
      c.set('merchant', merchant);
      c.set('authKind', 'api_key');
      c.set('apiKeyId', found.keyRowId);
    } else {
      await authenticateSession(deps, c, names.session, origins);
      const merchant = await getMerchantByUser(deps.db, c.get('session').userId);
      if (!merchant) throw conflict('merchant_required', 'Create a merchant first');
      c.set('merchant', merchant);
      c.set('authKind', 'session');
    }
    await next();
  };
}

/** Hash of the credential for rate-limit buckets: the raw secret is never used as a map key. */
export function rateKey(c: Context, fallbackIp: string): string {
  const header = c.req.header('authorization');
  return header ? `k:${sha256(header).toString('hex').slice(0, 24)}` : `ip:${fallbackIp}`;
}
