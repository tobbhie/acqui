import { Hono } from 'hono';
import { getNetwork } from '@acqui/shared';
import type { AppDeps, HonoEnv } from '../context';
import { parseBody, requireMerchantAuth, validate } from '../http';
import { badRequest, notFound } from '../lib/errors';
import { createPaymentIntent } from '../payments/create';
import { getPaymentForMerchant, listPayments } from '../payments/read';
import { merchantView, parsePaymentId, type ViewContext } from '../payments/views';
import { createPaymentIntentSchema, idempotencyKeySchema, listPaymentsQuerySchema } from '../schemas';

export function viewContext(deps: AppDeps): ViewContext {
  const net = getNetwork(deps.config.ACQUI_NETWORK);
  return { checkoutBaseUrl: deps.config.CHECKOUT_BASE_URL, usdcAddress: deps.contracts?.usdc ?? net.usdcErc20, livemode: net.isMainnet };
}

/** Merchant API. Every handler reads the merchant from the credential, never from the request. */
export function paymentRoutes(deps: AppDeps): Hono<HonoEnv> {
  const app = new Hono<HonoEnv>();
  const chainId = getNetwork(deps.config.ACQUI_NETWORK).chainId;
  app.use('*', requireMerchantAuth(deps));

  app.post('/payment-intents', async (c) => {
    const key = c.req.header('idempotency-key');
    if (!key) throw badRequest('idempotency_key_required', 'Idempotency-Key header is required');
    const idempotencyKey = validate(idempotencyKeySchema, key);
    const input = await parseBody(c, createPaymentIntentSchema);
    const { row, replayed } = await createPaymentIntent(deps, c.get('merchant'), idempotencyKey, input);
    c.header('Idempotent-Replayed', String(replayed));
    return c.json(merchantView(row, viewContext(deps)), replayed ? 200 : 201);
  });

  app.get('/payment-intents/:id', async (c) => {
    const id = parsePaymentId(c.req.param('id'));
    const row = id ? await getPaymentForMerchant(deps.db, c.get('merchant').id, chainId, id) : null;
    if (!row) throw notFound('Payment not found');
    return c.json(merchantView(row, viewContext(deps)));
  });

  app.get('/payments', async (c) => {
    const q = validate(listPaymentsQuerySchema, c.req.query());
    const { rows, nextCursor } = await listPayments(deps.db, c.get('merchant').id, chainId, q);
    const ctx = viewContext(deps);
    return c.json({ data: rows.map((r) => merchantView(r, ctx)), next_cursor: nextCursor });
  });

  return app;
}
