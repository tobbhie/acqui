import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { Hono } from 'hono';
import { z } from 'zod';
import { WEBHOOK_SIGNATURE_HEADER, WEBHOOK_TIMESTAMP_HEADER } from '@acqui/shared';
import type { AppDeps, HonoEnv } from '../context';
import { parseBody, validate } from '../http';
import { ApiError, badRequest, notFound, unauthorized } from '../lib/errors';
import { unitsToDecimal } from '../lib/units';

/**
 * Demo storefront backend. It behaves like any outside merchant backend: the demo merchant's API key
 * lives only here, payments are created over the public merchant API, and an order is "paid" only after
 * that API (or a signed webhook) reports the payment as settled. A redirect back from checkout proves nothing.
 */
export const DEMO_PRODUCTS = [
  { id: 'sticker-pack', name: 'Acqui sticker pack', blurb: 'Five die-cut vinyl stickers.', price: '1.00', units: 1_000_000n },
  { id: 'canvas-tote', name: 'Canvas tote bag', blurb: 'Heavy cotton, one size.', price: '2.00', units: 2_000_000n },
] as const;

const WEBHOOK_TOLERANCE_SECONDS = 300;

const createOrderSchema = z.object({ product_id: z.enum(['sticker-pack', 'canvas-tote']) }).strict();

const upstreamPayment = z.object({
  payment_id: z.string(),
  public_id: z.string(),
  status: z.string(),
  checkout_url: z.string().url(),
  chain_id: z.number().int(),
  settlement: z.object({ tx_hash: z.string().regex(/^0x[0-9a-fA-F]{64}$/) }).nullable(),
});

const webhookEvent = z.object({
  type: z.string(),
  data: z.object({ payment_id: z.string(), settlement_tx_hash: z.string().regex(/^0x[0-9a-fA-F]{64}$/).nullable().optional() }),
});

interface OrderRow {
  id: string;
  product_id: string;
  amount_units: string;
  payment_id: string | null;
  public_id: string | null;
  status: 'created' | 'pending' | 'paid' | 'failed';
  settlement_tx_hash: string | null;
  confirmed_via: 'api' | 'webhook' | null;
}

export function verifyWebhookSignature(
  secret: string,
  headers: { timestamp: string | undefined; signature: string | undefined },
  rawBody: string,
  nowSeconds: number,
): boolean {
  const timestamp = Number(headers.timestamp);
  if (!Number.isInteger(timestamp) || Math.abs(nowSeconds - timestamp) > WEBHOOK_TOLERANCE_SECONDS) return false;
  const given = /^v1=([0-9a-f]{64})$/.exec(headers.signature ?? '')?.[1];
  if (!given) return false;
  const expected = createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest();
  return timingSafeEqual(expected, Buffer.from(given, 'hex'));
}

export function demoRoutes(deps: AppDeps): Hono<HonoEnv> {
  const app = new Hono<HonoEnv>();
  const apiBase = (deps.config.DEMO_API_BASE_URL ?? `http://127.0.0.1:${deps.config.PORT}`).replace(/\/+$/, '');
  const webBase = new URL(deps.config.DASHBOARD_BASE_URL ?? deps.config.CHECKOUT_BASE_URL).origin;
  // Read at request time so configuration and the transport can be swapped without rebuilding the app.
  const call = (url: string, init: RequestInit) => (deps.selfFetch ?? ((u: string, i: RequestInit) => fetch(u, i)))(url, init);

  app.use('*', async (c, next) => {
    await next();
    c.header('Cache-Control', 'no-store');
  });

  app.get('/products', (c) => c.json({ enabled: Boolean(deps.config.DEMO_MERCHANT_API_KEY), return_origin: webBase, products: DEMO_PRODUCTS.map(({ id, name, blurb, price }) => ({ id, name, blurb, price })) }));

  app.post('/orders', async (c) => {
    const key = deps.config.DEMO_MERCHANT_API_KEY;
    if (!key) throw new ApiError(503, 'demo_disabled', 'The demo store is not configured on this server');
    const { product_id } = await parseBody(c, createOrderSchema);
    const product = DEMO_PRODUCTS.find((p) => p.id === product_id);
    if (!product) throw badRequest('unknown_product', 'Unknown product');
    const amountUnits = product.units;

    const orderId = randomUUID();
    await deps.db`INSERT INTO demo_orders (id, product_id, amount_units) VALUES (${orderId}, ${product.id}, ${amountUnits.toString()})`;

    // Server-to-server, exactly like an outside merchant backend. The key never reaches a browser.
    const res = await call(`${apiBase}/v1/payment-intents`, {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json', 'idempotency-key': `demo-${orderId}` },
      body: JSON.stringify({
        amount: unitsToDecimal(amountUnits),
        currency: 'USDC',
        network: 'arc',
        order_id: `demo-${orderId}`,
        description: product.name,
        success_url: `${webBase}/demo/order/${orderId}`,
        cancel_url: `${webBase}/demo`,
      }),
    });
    const json: unknown = await res.json().catch(() => null);
    if (!res.ok) {
      await deps.db`UPDATE demo_orders SET status = 'failed', updated_at = now() WHERE id = ${orderId}`;
      const upstream = z.object({ error: z.object({ code: z.string() }) }).safeParse(json);
      const code = upstream.success ? upstream.data.error.code : 'unknown';
      if (code === 'return_origin_not_configured' || code === 'return_origin_not_allowed') {
        throw new ApiError(503, 'demo_return_origin_mismatch',
          `The demo merchant's return origin must be exactly ${webBase} (origin only, no path). Set it in the merchant dashboard under Settings.`);
      }
      throw new ApiError(503, 'payments_unavailable', `Payments are unavailable right now (${code})`);
    }
    const payment = upstreamPayment.parse(json);
    await deps.db`
      UPDATE demo_orders SET payment_id = ${payment.payment_id}, public_id = ${payment.public_id}, status = 'pending', updated_at = now()
      WHERE id = ${orderId}`;
    return c.json({ order_id: orderId, checkout_url: payment.checkout_url }, 201);
  });

  app.get('/orders/:id', async (c) => {
    const key = deps.config.DEMO_MERCHANT_API_KEY;
    const id = validate(z.string().uuid(), c.req.param('id'));
    const rows = await deps.db<OrderRow[]>`SELECT * FROM demo_orders WHERE id = ${id}`;
    let order = rows[0];
    if (!order) throw notFound('Order not found');
    const product = DEMO_PRODUCTS.find((p) => p.id === order?.product_id);

    let paymentStatus: string | null = null;
    let verification: 'verified' | 'unavailable' | 'none' = 'none';
    let checkoutUrl: string | null = null;
    if (order.status !== 'paid' && order.payment_id && key) {
      // Verified API call: the redirect that brought the customer here is never trusted.
      try {
        const res = await call(`${apiBase}/v1/payment-intents/${order.payment_id}`, { headers: { authorization: `Bearer ${key}` } });
        if (!res.ok) throw new Error(`payments API ${res.status}`);
        const payment = upstreamPayment.parse(await res.json());
        paymentStatus = payment.status;
        verification = 'verified';
        if (!['expired', 'settled', 'underpaid', 'recovery_required'].includes(payment.status)) checkoutUrl = payment.checkout_url;
        if (payment.status === 'settled' && payment.settlement) {
          const updated = await deps.db<OrderRow[]>`
            UPDATE demo_orders SET status = 'paid', settlement_tx_hash = ${payment.settlement.tx_hash}, confirmed_via = 'api', updated_at = now()
            WHERE id = ${order.id} AND status <> 'paid' RETURNING *`;
          order = updated[0] ?? (await deps.db<OrderRow[]>`SELECT * FROM demo_orders WHERE id = ${id}`)[0] ?? order;
        }
      } catch {
        verification = 'unavailable';
      }
    }

    const fulfilment =
      order.status === 'paid' ? 'paid'
      : order.status === 'failed' ? 'failed'
      : paymentStatus === 'expired' ? 'expired'
      : paymentStatus === 'underpaid' || paymentStatus === 'recovery_required' ? 'attention'
      : 'pending';
    return c.json({
      order_id: order.id,
      product: product ? { id: product.id, name: product.name } : null,
      amount: unitsToDecimal(BigInt(order.amount_units)),
      fulfilment,
      payment_status: order.status === 'paid' ? 'settled' : paymentStatus,
      verification,
      confirmed_via: order.confirmed_via,
      settlement_tx_hash: order.status === 'paid' ? order.settlement_tx_hash : null,
      checkout_url: fulfilment === 'pending' ? checkoutUrl : null,
    });
  });

  // Receiver for the demo merchant's signed webhook. Unsigned or stale requests are rejected.
  app.post('/webhook', async (c) => {
    const secret = deps.config.DEMO_WEBHOOK_SECRET;
    if (!secret) throw new ApiError(503, 'demo_disabled', 'Demo webhook receiver is not configured');
    const raw = await c.req.text();
    if (raw.length > 16 * 1024) throw badRequest('payload_too_large', 'Payload too large');
    const ok = verifyWebhookSignature(
      secret,
      { timestamp: c.req.header(WEBHOOK_TIMESTAMP_HEADER), signature: c.req.header(WEBHOOK_SIGNATURE_HEADER) },
      raw,
      Math.floor(deps.now().getTime() / 1000),
    );
    if (!ok) throw unauthorized('Invalid webhook signature');
    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch {
      throw badRequest('invalid_json', 'Body is not valid JSON');
    }
    const parsed = webhookEvent.safeParse(json);
    if (parsed.success && parsed.data.type === 'payment.settled' && parsed.data.data.settlement_tx_hash) {
      await deps.db`
        UPDATE demo_orders SET status = 'paid', settlement_tx_hash = ${parsed.data.data.settlement_tx_hash}, confirmed_via = 'webhook', updated_at = now()
        WHERE payment_id = ${parsed.data.data.payment_id} AND status <> 'paid'`;
    }
    return c.json({ received: true });
  });

  return app;
}
