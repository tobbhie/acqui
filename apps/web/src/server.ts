import { relative, resolve } from 'node:path';
import { Hono } from 'hono';
import { secureHeaders } from 'hono/secure-headers';
import { serveStatic } from '@hono/node-server/serve-static';

export interface WebOptions {
  /** Directory with the built single page app (output of `vite build`). */
  distDir: string;
  /** Where the Acqui API listens, for example http://api.railway.internal:8080. Browsers never see this address. */
  apiBaseUrl: string;
  fetchImpl?: (url: string, init: RequestInit) => Promise<Response>;
}

const HOP_BY_HOP = new Set(['connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailer', 'trailers', 'transfer-encoding', 'upgrade', 'host', 'content-length']);

/** The last X-Forwarded-For entry is the one the platform edge appended; earlier entries are client-controlled. */
export function edgeClientIp(forwardedFor: string | undefined): string | undefined {
  const parts = forwardedFor?.split(',').map((p) => p.trim()).filter(Boolean);
  return parts && parts.length > 0 ? parts[parts.length - 1] : undefined;
}

/**
 * Serves the web app and forwards /api/* to the API with the prefix removed, so the browser only ever talks to
 * one origin and session cookies stay first-party. Redirects (Google sign-in) and Set-Cookie headers pass through untouched.
 */
export function createWebApp(opts: WebOptions): Hono {
  const app = new Hono();
  const apiBase = opts.apiBaseUrl.replace(/\/+$/, '');
  const doFetch = opts.fetchImpl ?? ((url: string, init: RequestInit) => fetch(url, init));
  const root = relative(process.cwd(), resolve(opts.distDir)) || '.';

  // Hosted checkout must never be framed: a hidden frame could trick a customer into paying.
  app.use('*', secureHeaders({ xFrameOptions: 'DENY', contentSecurityPolicy: { frameAncestors: ["'none'"] } }));

  app.get('/health', (c) => c.json({ ok: true, service: 'acqui-web' }));

  app.all('/api/*', async (c) => {
    const url = new URL(c.req.url);
    const target = `${apiBase}${url.pathname.slice('/api'.length)}${url.search}`;
    const headers = new Headers();
    for (const [name, value] of c.req.raw.headers) {
      if (!HOP_BY_HOP.has(name.toLowerCase()) && name.toLowerCase() !== 'x-forwarded-for') headers.set(name, value);
    }
    const ip = edgeClientIp(c.req.header('x-forwarded-for'));
    if (ip) headers.set('x-forwarded-for', ip);
    headers.set('x-forwarded-host', c.req.header('host') ?? url.host);
    headers.set('x-forwarded-proto', c.req.header('x-forwarded-proto') ?? url.protocol.replace(':', ''));
    const hasBody = c.req.method !== 'GET' && c.req.method !== 'HEAD';
    try {
      const upstream = await doFetch(target, {
        method: c.req.method,
        headers,
        ...(hasBody ? { body: c.req.raw.body, duplex: 'half' } : {}),
        redirect: 'manual',
        signal: AbortSignal.timeout(30_000),
      });
      const out = new Headers(upstream.headers);
      // fetch already decoded the body, so the encoding and length headers no longer describe it.
      out.delete('content-encoding');
      out.delete('content-length');
      return new Response(upstream.body, { status: upstream.status, headers: out });
    } catch {
      return c.json({ error: { code: 'upstream_unavailable', message: 'The Acqui API is not reachable right now' } }, 502);
    }
  });

  // Hashed build files never change, everything else (the HTML shell) must be revalidated on each visit.
  app.use('*', async (c, next) => {
    await next();
    const path = c.req.path;
    if (c.res.status !== 200 || path === '/health' || path.startsWith('/api/')) return;
    c.res.headers.set('Cache-Control', path.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache');
  });
  app.use('*', serveStatic({ root }));
  // Any other GET is a client-side route (/demo, /merchants, /pay/{id}, /dashboard/...).
  app.get('*', serveStatic({ path: `${root}/index.html` }));
  return app;
}
