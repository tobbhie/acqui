import { Hono } from 'hono';
import type { AppDeps, HonoEnv } from '../context';
import { parseBody, requireMerchantSession, requireSession, validate } from '../http';
import { createMerchant, merchantSettingsView, setInitialPayout, updateSettings } from '../merchants';
import { createApiKey, listApiKeys, revokeApiKey, rotateApiKey } from '../apiKeys';
import { assertNotBlocklisted, confirmPayoutChange, requestPayoutChange } from '../payouts';
import { hasActiveWebhookSecret, rotateWebhookSecret } from '../webhookSecrets';
import {
  createApiKeySchema, createMerchantSchema, initialPayoutSchema, payoutChangeConfirmSchema,
  payoutChangeRequestSchema, rotateApiKeySchema, updateMerchantSchema,
} from '../schemas';
import { z } from 'zod';

const uuid = z.string().uuid();

/** Dashboard endpoints: cookie session + CSRF only. API keys cannot manage keys, payouts or webhooks. */
export function merchantRoutes(deps: AppDeps): Hono<HonoEnv> {
  const app = new Hono<HonoEnv>();
  const production = deps.config.NODE_ENV === 'production';
  const view = async (m: Parameters<typeof merchantSettingsView>[0]) =>
    merchantSettingsView(m, {
      payoutChangesEnabled: deps.config.payoutChangesEnabled,
      hasWebhookSecret: await hasActiveWebhookSecret(deps.db, m.id),
    });

  app.use('*', requireSession(deps));

  app.post('/', async (c) => {
    const body = await parseBody(c, createMerchantSchema);
    const merchant = await createMerchant(deps.db, c.get('session').userId, body.display_name);
    return c.json(await view(merchant), 201);
  });

  const scoped = new Hono<HonoEnv>();
  scoped.use('*', requireMerchantSession(deps));

  scoped.get('/', async (c) => c.json(await view(c.get('merchant'))));

  scoped.patch('/', async (c) => {
    const body = await parseBody(c, updateMerchantSchema);
    return c.json(await view(await updateSettings(deps.db, c.get('merchant'), body, production)));
  });

  // Initial payout address: typed twice and explicitly acknowledged.
  scoped.post('/payout-address', async (c) => {
    const body = await parseBody(c, initialPayoutSchema);
    await assertNotBlocklisted(deps, body.payout_address);
    return c.json(await view(await setInitialPayout(deps.db, c.get('merchant').id, body.payout_address)));
  });

  scoped.post('/payout-address/change', async (c) => {
    const body = await parseBody(c, payoutChangeRequestSchema);
    const s = c.get('session');
    const { expiresAt } = await requestPayoutChange(deps, c.get('merchant'), { userId: s.userId, email: s.email }, body.new_address);
    return c.json({ status: 'confirmation_sent', expires_at: expiresAt.toISOString() }, 202);
  });

  scoped.post('/payout-address/confirm', async (c) => {
    const body = await parseBody(c, payoutChangeConfirmSchema);
    const s = c.get('session');
    return c.json(await view(await confirmPayoutChange(deps, c.get('merchant'), { userId: s.userId, email: s.email }, body.token)));
  });

  scoped.get('/api-keys', async (c) => c.json({ data: await listApiKeys(deps.db, c.get('merchant').id) }));

  scoped.post('/api-keys', async (c) => {
    const body = await parseBody(c, createApiKeySchema);
    const { key, secret } = await createApiKey(deps.db, c.get('merchant').id, body.label, deps.config.API_KEY_PEPPER, deps.now());
    c.header('Cache-Control', 'no-store');
    // The secret appears in this response only. It is not stored and cannot be retrieved later.
    return c.json({ ...key, secret }, 201);
  });

  scoped.post('/api-keys/:id/rotate', async (c) => {
    const id = validate(uuid, c.req.param('id'));
    const body = await parseBody(c, rotateApiKeySchema);
    const merchantId = c.get('merchant').id;
    const { key, secret } = await deps.db.begin((tx) => rotateApiKey(tx, merchantId, id, body.grace_seconds, deps.config.API_KEY_PEPPER, deps.now()));
    c.header('Cache-Control', 'no-store');
    return c.json({ ...key, secret }, 201);
  });

  scoped.delete('/api-keys/:id', async (c) => {
    await revokeApiKey(deps.db, c.get('merchant').id, validate(uuid, c.req.param('id')));
    return c.body(null, 204);
  });

  // Create or rotate the webhook signing secret. Shown once.
  scoped.post('/webhook-secret', async (c) => {
    const { secret, createdAt } = await deps.db.begin((tx) =>
      rotateWebhookSecret(tx, c.get('merchant').id, deps.config.WEBHOOK_SECRET_ENCRYPTION_KEY));
    c.header('Cache-Control', 'no-store');
    return c.json({ secret, created_at: createdAt.toISOString() }, 201);
  });

  app.route('/', scoped);
  return app;
}
