/**
 * Cloudflare Pages edge proxy: forwards /api/* to the Acqui API so the browser only ever talks to the website's own
 * origin. That keeps the HttpOnly session cookie first-party (no third-party cookie problems) and needs no CORS.
 * Runs as a Pages Function (functions/api/[[path]].ts) and is plain Request/Response code, so it is unit tested here.
 */
export interface ProxyEnv {
  /** Public HTTPS origin of the Northflank API service, for example https://api--acqui--abc123.code.run. No path. */
  API_ORIGIN?: string;
  /** Same value as PROXY_SHARED_SECRET on the API. Lets the API trust the client address forwarded here. */
  PROXY_SHARED_SECRET?: string;
}

type Fetcher = (input: string, init: RequestInit) => Promise<Response>;

const DROP_REQUEST_HEADERS = new Set([
  'connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailer', 'trailers', 'transfer-encoding', 'upgrade',
  'host', 'content-length', 'accept-encoding', 'x-forwarded-for', 'x-forwarded-host', 'x-forwarded-proto', 'x-real-ip',
]);

const json = (status: number, code: string, message: string): Response =>
  Response.json({ error: { code, message } }, { status, headers: { 'cache-control': 'no-store' } });

/** Returns the validated API origin or null. HTTPS only (plain http is allowed for localhost development). */
export function parseApiOrigin(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
    if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) return null;
    if (url.username || url.password || url.search || url.hash || (url.pathname !== '/' && url.pathname !== '')) return null;
    return url.origin;
  } catch {
    return null;
  }
}

export async function proxyToApi(request: Request, env: ProxyEnv, doFetch: Fetcher = (input, init) => fetch(input, init)): Promise<Response> {
  const origin = parseApiOrigin(env.API_ORIGIN);
  if (!origin) return json(500, 'api_origin_not_configured', 'API_ORIGIN must be the public HTTPS origin of the API');

  const url = new URL(request.url);
  const target = `${origin}${url.pathname.slice('/api'.length)}${url.search}`;

  const headers = new Headers();
  for (const [name, value] of request.headers) {
    const lower = name.toLowerCase();
    // Never pass cf-* internals, or any X-Acqui-* header a caller might use to impersonate the edge.
    if (DROP_REQUEST_HEADERS.has(lower) || lower.startsWith('cf-') || lower.startsWith('x-acqui-')) continue;
    headers.set(name, value);
  }
  // The origin is not compressed so the body can be streamed back unchanged; Cloudflare compresses for the browser.
  headers.set('accept-encoding', 'identity');
  headers.set('x-forwarded-host', url.host);
  headers.set('x-forwarded-proto', url.protocol.replace(':', ''));
  const visitor = request.headers.get('cf-connecting-ip');
  if (visitor && env.PROXY_SHARED_SECRET) {
    headers.set('x-acqui-client-ip', visitor);
    headers.set('x-acqui-proxy-secret', env.PROXY_SHARED_SECRET);
  }

  const hasBody = request.method !== 'GET' && request.method !== 'HEAD';
  try {
    const upstream = await doFetch(target, {
      method: request.method,
      headers,
      ...(hasBody ? { body: request.body, duplex: 'half' } : {}),
      // Sign-in redirects (to Google and back) must reach the browser as they are, not be followed here.
      redirect: 'manual',
      signal: AbortSignal.timeout(30_000),
    } as RequestInit);
    const out = new Headers(upstream.headers);
    out.delete('content-length');
    out.delete('content-encoding');
    return new Response(upstream.body, { status: upstream.status, headers: out });
  } catch {
    return json(502, 'upstream_unavailable', 'The Acqui API is not reachable right now');
  }
}
