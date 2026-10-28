import { isIP } from 'node:net';
import { unprocessable } from './errors';

const MAX_URL_LENGTH = 2048;
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

function parse(raw: string, field: string): URL {
  if (raw.length > MAX_URL_LENGTH) throw unprocessable('invalid_url', `${field} is too long`);
  try {
    return new URL(raw);
  } catch {
    throw unprocessable('invalid_url', `${field} is not a valid URL`);
  }
}

/** https everywhere; http only for localhost outside production. No embedded credentials. */
function assertScheme(url: URL, field: string, production: boolean): void {
  const localHttp = url.protocol === 'http:' && !production && LOCAL_HOSTS.has(url.hostname);
  if (url.protocol !== 'https:' && !localHttp) throw unprocessable('invalid_url', `${field} must use https`);
  if (url.username || url.password) throw unprocessable('invalid_url', `${field} must not contain credentials`);
}

/** A bare origin such as https://shop.example.com (no path, query or fragment). Returns the normalized origin. */
export function parseOrigin(raw: string, field: string, production: boolean): string {
  const url = parse(raw, field);
  assertScheme(url, field, production);
  if ((url.pathname !== '/' && url.pathname !== '') || url.search || url.hash) {
    throw unprocessable('invalid_url', `${field} must be an origin without path, query or fragment`);
  }
  return url.origin;
}

/** success/cancel URLs must sit on the merchant's allowlisted return origin. */
export function parseReturnUrl(raw: string, allowedOrigin: string | null, field: string, production: boolean): string {
  const url = parse(raw, field);
  assertScheme(url, field, production);
  if (allowedOrigin === null) {
    throw unprocessable('return_origin_not_configured', `Set an allowed return origin before using ${field}`);
  }
  if (url.origin !== allowedOrigin) {
    throw unprocessable('return_origin_not_allowed', `${field} must be on ${allowedOrigin}`);
  }
  return url.toString();
}

function isPrivateIpv4(host: string): boolean {
  const [a = 0, b = 0] = host.split('.').map(Number);
  return (
    a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224
  );
}

function isPrivateIpv6(host: string): boolean {
  const h = host.replace(/^\[|\]$/g, '').toLowerCase();
  return h === '::' || h === '::1' || h.startsWith('fc') || h.startsWith('fd') || h.startsWith('fe80') || h.startsWith('::ffff:');
}

/**
 * Webhook endpoints: https only, standard ports, no credentials, no IP literals in private ranges and no
 * internal-looking names. DNS is re-checked at delivery time by the worker (rebinding defence).
 */
export function parseWebhookUrl(raw: string, production: boolean): string {
  const url = parse(raw, 'webhook_url');
  if (url.protocol !== 'https:') throw unprocessable('invalid_url', 'webhook_url must use https');
  assertScheme(url, 'webhook_url', production);
  if (url.port && url.port !== '443' && url.port !== '8443') {
    throw unprocessable('invalid_url', 'webhook_url must use port 443 or 8443');
  }
  const host = url.hostname.toLowerCase();
  const family = isIP(host.replace(/^\[|\]$/g, ''));
  const internalName = host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal') || host.endsWith('.localhost') || !host.includes('.');
  if (
    (family === 4 && isPrivateIpv4(host)) ||
    (family === 6 && isPrivateIpv6(host)) ||
    (family === 0 && internalName)
  ) {
    throw unprocessable('invalid_url', 'webhook_url must be a public host');
  }
  return url.toString();
}
