import { Hono } from 'hono';
import { getNetwork } from '@acqui/shared';
import type { AppDeps } from '../context';
import { notFound } from '../lib/errors';
import { getPublicByPublicId } from '../payments/read';
import { publicStatusView, publicView } from '../payments/views';
import { viewContext } from './payments';

const PUBLIC_ID = /^[A-Za-z0-9_-]{22}$/;

/**
 * Checkout read model. Reads the database only (the worker keeps it current), so customer polling never
 * touches the chain. Responses carry no merchant ids, order ids, payout addresses or secrets.
 */
export function publicRoutes(deps: AppDeps): Hono {
  const app = new Hono();

  app.use('*', async (c, next) => {
    await next();
    c.header('Cache-Control', 'no-store');
  });

  // What the browser needs to label the environment honestly. Booleans and ids only, no secrets.
  app.get('/config', (c) => {
    const net = getNetwork(deps.config.ACQUI_NETWORK);
    return c.json({
      network: net.id,
      chain_id: net.chainId,
      livemode: net.isMainnet,
      payments_ready: deps.contracts !== null,
      payout_changes_enabled: deps.config.payoutChangesEnabled,
      demo_enabled: Boolean(deps.config.DEMO_MERCHANT_API_KEY),
    });
  });

  app.get('/payments/:publicId', async (c) => {
    const id = c.req.param('publicId');
    const row = PUBLIC_ID.test(id) ? await getPublicByPublicId(deps.db, id) : null;
    if (!row) throw notFound('Payment not found');
    return c.json(publicView(row, viewContext(deps), deps.now()));
  });

  app.get('/payments/:publicId/status', async (c) => {
    const id = c.req.param('publicId');
    const row = PUBLIC_ID.test(id) ? await getPublicByPublicId(deps.db, id) : null;
    if (!row) throw notFound('Payment not found');
    return c.json(publicStatusView(row, deps.now()));
  });

  return app;
}
