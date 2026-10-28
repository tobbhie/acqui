import { createHmac, randomUUID } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { WEBHOOK_SIGNATURE_HEADER, WEBHOOK_TIMESTAMP_HEADER } from '@acqui/shared';
import type { Db, Q } from '../../api/src/db';
import { ApiError } from '../../api/src/lib/errors';
import { unitsToDecimal } from '../../api/src/lib/units';
import { parseWebhookUrl } from '../../api/src/lib/urls';
import { paymentIdOf } from '../../api/src/payments/views';
import { loadActiveWebhookSecret } from '../../api/src/webhookSecrets';
import { resolvePublicAddress, UnsafeDestinationError, type LookupAll } from './ssrf';
import type { Logger } from './types';

export type WebhookEvent = 'payment.settled' | 'payment.expired';

/** HMAC-SHA256 over `${timestamp}.${rawBody}`, hex. Merchants recompute it on the raw bytes they received. */
export function signWebhook(secret: string, timestamp: number, body: string): string {
  return createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
}

interface IntentForHook {
  id: string; merchant_id: string; order_id: string; status: string; gross_units: string; protocol_fee_units: string;
  keeper_reimbursement_units: string; merchant_net_units: string; chain_id: number; receiver_address: string;
  settlement_tx_hash: string | null; settled_at: Date | null; expires_at: Date; webhook_url: string | null;
}

/**
 * Writes the delivery into the outbox in the caller's transaction (so a settled payment can never exist without its
 * event). The exact body is stored as text: the signature covers these bytes. Returns false when the merchant has no
 * webhook URL, or the event was already queued (unique per payment and event type).
 */
export async function enqueueWebhook(q: Q, paymentIntentId: string, event: WebhookEvent, now: Date): Promise<boolean> {
  const rows = await q<IntentForHook[]>`
    SELECT p.id, p.merchant_id, p.order_id, p.status, p.gross_units, p.protocol_fee_units, p.keeper_reimbursement_units,
           p.merchant_net_units, p.chain_id, p.receiver_address, p.settlement_tx_hash, p.settled_at, p.expires_at, m.webhook_url
    FROM payment_intents p JOIN merchants m ON m.id = p.merchant_id WHERE p.id = ${paymentIntentId}`;
  const p = rows[0];
  if (!p || !p.webhook_url) return false;
  if (event === 'payment.settled' && (p.status !== 'settled' || !p.settlement_tx_hash)) {
    throw new Error('payment.settled can only be queued for a settled payment');
  }
  const id = randomUUID();
  const data =
    event === 'payment.settled'
      ? {
          payment_id: paymentIdOf(p.id), order_id: p.order_id, status: 'settled', currency: 'USDC',
          gross: unitsToDecimal(BigInt(p.gross_units)), fee: unitsToDecimal(BigInt(p.protocol_fee_units)),
          keeper_reimbursement: unitsToDecimal(BigInt(p.keeper_reimbursement_units)),
          net: unitsToDecimal(BigInt(p.merchant_net_units)), network: 'arc', chain_id: p.chain_id,
          receiver_address: p.receiver_address, settlement_tx_hash: p.settlement_tx_hash,
          settled_at: p.settled_at?.toISOString() ?? null,
        }
      : {
          payment_id: paymentIdOf(p.id), order_id: p.order_id, status: 'expired', currency: 'USDC',
          gross: unitsToDecimal(BigInt(p.gross_units)), network: 'arc', chain_id: p.chain_id, expires_at: p.expires_at.toISOString(),
        };
  const payload = { id, type: event, created_at: now.toISOString(), data };
  const body = JSON.stringify(payload);
  const inserted = await q<{ id: string }[]>`
    INSERT INTO webhook_deliveries (id, merchant_id, payment_intent_id, event_type, payload, body, url, next_attempt_at)
    VALUES (${id}, ${p.merchant_id}, ${p.id}, ${event}, ${q.json(payload)}, ${body}, ${p.webhook_url}, ${now})
    ON CONFLICT (payment_intent_id, event_type) DO NOTHING RETURNING id`;
  return inserted.length > 0;
}

export interface PostRequest { url: string; headers: Record<string, string>; body: string; timeoutMs: number }
export interface PostResult { status: number }
export type HttpPoster = (req: PostRequest) => Promise<PostResult>;

/** Retry schedule in seconds after attempt N fails. Delivery gives up after the last entry (about 28 hours total). */
export const RETRY_DELAYS_SECONDS = [30, 60, 120, 300, 600, 1800, 3600, 7200, 14_400, 28_800, 43_200] as const;
export const MAX_ATTEMPTS = RETRY_DELAYS_SECONDS.length + 1;

export function nextDelaySeconds(attemptsMade: number, random: () => number = Math.random): number | null {
  const base = RETRY_DELAYS_SECONDS[attemptsMade - 1];
  if (base === undefined) return null;
  return Math.round(base * (0.8 + random() * 0.4));
}

export interface SafePosterOptions {
  lookup?: LookupAll;
  /** Test seams only. Production code never sets these. */
  unsafeAllowHttpForTests?: boolean;
}

/**
 * SSRF-hardened POST: https only, DNS answers must all be public, the connection is pinned to the IP that was
 * checked (TLS still validates the certificate against the hostname), redirects are never followed, the response
 * body is discarded after a small cap, and everything has a hard timeout.
 */
export function createSafePoster(options: SafePosterOptions = {}): HttpPoster {
  return async (req) => {
    const url = new URL(req.url);
    const allowHttp = options.unsafeAllowHttpForTests === true && url.protocol === 'http:';
    if (url.protocol !== 'https:' && !allowHttp) throw new UnsafeDestinationError('Webhook URL must use https');
    if (url.username || url.password) throw new UnsafeDestinationError('Webhook URL must not contain credentials');
    const target = allowHttp ? { address: url.hostname, family: 4 as const } : await resolvePublicAddress(url.hostname, options.lookup);
    const doRequest = allowHttp ? httpRequest : httpsRequest;
    return new Promise<PostResult>((resolve, reject) => {
      let settled = false;
      const finish = (fn: () => void) => { if (!settled) { settled = true; clearTimeout(hardTimer); fn(); } };
      // A hard wall-clock deadline for the whole exchange: socket idle timeouts alone do not bound a slow-drip server.
      const hardTimer = setTimeout(() => { clientReq.destroy(); finish(() => reject(new Error('timeout'))); }, req.timeoutMs);
      const clientReq = doRequest(
        {
          host: target.address, family: target.family, port: url.port || (allowHttp ? 80 : 443), method: 'POST',
          path: `${url.pathname}${url.search}`, servername: url.hostname,
          headers: { ...req.headers, host: url.host, 'content-length': String(Buffer.byteLength(req.body)) },
        },
        (res) => {
          let seen = 0;
          res.on('data', (chunk: Buffer) => {
            seen += chunk.length;
            if (seen > 4096) res.destroy();
          });
          res.on('close', () => finish(() => resolve({ status: res.statusCode ?? 0 })));
          res.on('error', () => finish(() => resolve({ status: res.statusCode ?? 0 })));
        },
      );
      clientReq.on('error', (error) => finish(() => reject(error)));
      clientReq.end(req.body);
    });
  };
}

export interface DeliveryCtx {
  db: Db;
  encryptionKey: string;
  post: HttpPoster;
  production: boolean;
  now: () => Date;
  log: Logger;
  onFailure?: (code: string, message: string, details: Record<string, unknown>) => void;
  random?: () => number;
}

interface Claimed { id: string; merchant_id: string; body: string; attempts: number; event_type: string; payment_intent_id: string }

/** Claims due deliveries (leased so a crash only delays them), sends them, and records the outcome. */
export async function deliverDue(ctx: DeliveryCtx, limit = 20): Promise<{ delivered: number; failed: number; retried: number }> {
  const now = ctx.now();
  const claimed = await ctx.db<Claimed[]>`
    UPDATE webhook_deliveries SET attempts = attempts + 1, last_attempt_at = ${now}, next_attempt_at = ${new Date(now.getTime() + 120_000)}
    WHERE id IN (SELECT id FROM webhook_deliveries WHERE status = 'pending' AND next_attempt_at <= ${now}
                 ORDER BY next_attempt_at LIMIT ${limit} FOR UPDATE SKIP LOCKED)
    RETURNING id, merchant_id, body, attempts, event_type, payment_intent_id`;
  let delivered = 0, failed = 0, retried = 0;
  for (const d of claimed) {
    const outcome = await attempt(ctx, d);
    if (outcome.ok) {
      await ctx.db`UPDATE webhook_deliveries SET status = 'delivered', delivered_at = ${ctx.now()}, last_status_code = ${outcome.status}, last_error = NULL WHERE id = ${d.id}`;
      delivered += 1;
      continue;
    }
    const delay = outcome.permanent ? null : nextDelaySeconds(d.attempts, ctx.random);
    if (delay === null) {
      await ctx.db`UPDATE webhook_deliveries SET status = 'failed', last_status_code = ${outcome.status ?? null}, last_error = ${outcome.error} WHERE id = ${d.id}`;
      ctx.onFailure?.('webhook_delivery_failed', 'Webhook delivery gave up', { deliveryId: d.id, error: outcome.error, attempts: d.attempts });
      failed += 1;
    } else {
      await ctx.db`UPDATE webhook_deliveries SET last_status_code = ${outcome.status ?? null}, last_error = ${outcome.error},
                   next_attempt_at = ${new Date(ctx.now().getTime() + delay * 1000)} WHERE id = ${d.id}`;
      retried += 1;
    }
    ctx.log.warn('webhook_attempt_failed', { deliveryId: d.id, attempt: d.attempts, error: outcome.error });
  }
  return { delivered, failed, retried };
}

type Outcome = { ok: true; status: number } | { ok: false; error: string; status?: number; permanent?: boolean };

async function attempt(ctx: DeliveryCtx, d: Claimed): Promise<Outcome> {
  const merchant = (await ctx.db<{ webhook_url: string | null }[]>`SELECT webhook_url FROM merchants WHERE id = ${d.merchant_id}`)[0];
  // The merchant's CURRENT url is used so that fixing a broken endpoint also repairs queued deliveries.
  if (!merchant?.webhook_url) return { ok: false, error: 'webhook_not_configured', permanent: true };
  let url: string;
  try {
    url = parseWebhookUrl(merchant.webhook_url, ctx.production);
  } catch (error) {
    return { ok: false, error: error instanceof ApiError ? `invalid_url:${error.code}` : 'invalid_url', permanent: true };
  }
  const secret = await loadActiveWebhookSecret(ctx.db, d.merchant_id, ctx.encryptionKey);
  if (!secret) return { ok: false, error: 'no_active_signing_secret' }; // never send unsigned; retry until one exists
  const timestamp = Math.floor(ctx.now().getTime() / 1000);
  try {
    const res = await ctx.post({
      url,
      timeoutMs: 10_000,
      body: d.body,
      headers: {
        'content-type': 'application/json',
        'user-agent': 'Acqui-Webhooks/1',
        [WEBHOOK_SIGNATURE_HEADER]: `v1=${signWebhook(secret, timestamp, d.body)}`,
        [WEBHOOK_TIMESTAMP_HEADER]: String(timestamp),
        'acqui-delivery-id': d.id,
        'acqui-event': d.event_type,
      },
    });
    if (res.status >= 200 && res.status < 300) return { ok: true, status: res.status };
    if (res.status >= 300 && res.status < 400) return { ok: false, error: 'redirect_not_followed', status: res.status };
    return { ok: false, error: `http_${res.status}`, status: res.status };
  } catch (error) {
    if (error instanceof UnsafeDestinationError) return { ok: false, error: `blocked:${error.message}` };
    return { ok: false, error: error instanceof Error ? error.message.slice(0, 120) : 'request_failed' };
  }
}
