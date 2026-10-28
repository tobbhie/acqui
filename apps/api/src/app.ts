import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { secureHeaders } from 'hono/secure-headers';
import { describeConfig, getNetwork } from '@acqui/shared';
import type { AppDeps, HonoEnv } from './context';
import { clientIp, rateKey } from './http';
import { errorHandler } from './lib/errors';
import { FixedWindowLimiter, rateLimit } from './lib/rate-limit';
import { authRoutes } from './routes/auth';
import { demoRoutes } from './routes/demo';
import { merchantRoutes } from './routes/merchant';
import { paymentRoutes } from './routes/payments';
import { publicRoutes } from './routes/public';

export interface Limits {
  perIpPerMinute: number;
  perKeyPerMinute: number;
  authPerIpPerMinute: number;
  demoOrdersPerIpPerMinute: number;
}
export const DEFAULT_LIMITS: Limits = { perIpPerMinute: 300, perKeyPerMinute: 120, authPerIpPerMinute: 20, demoOrdersPerIpPerMinute: 6 };

export function createApp(deps: AppDeps, limits: Limits = DEFAULT_LIMITS): Hono<HonoEnv> {
  const app = new Hono<HonoEnv>();
  const trustProxy = deps.config.TRUST_PROXY === 'true';
  const clock = () => deps.now().getTime();
  const ipLimiter = new FixedWindowLimiter(limits.perIpPerMinute, 60_000, clock);
  const keyLimiter = new FixedWindowLimiter(limits.perKeyPerMinute, 60_000, clock);
  const authLimiter = new FixedWindowLimiter(limits.authPerIpPerMinute, 60_000, clock);
  const demoLimiter = new FixedWindowLimiter(limits.demoOrdersPerIpPerMinute, 60_000, clock);
  const demoOrderLimit = rateLimit(demoLimiter, (c) => `demo:${clientIp(c, trustProxy)}`);

  const origins = new Set(
    [deps.config.DASHBOARD_BASE_URL, deps.config.CHECKOUT_BASE_URL].flatMap((u) => (u ? [new URL(u).origin] : [])),
  );

  app.onError(errorHandler);
  app.notFound((c) => c.json({ error: { code: 'not_found', message: 'Not found' } }, 404));
  app.use('*', secureHeaders());
  app.use('*', cors({
    origin: (origin) => (origins.has(origin) ? origin : null),
    credentials: true,
    allowHeaders: ['content-type', 'x-csrf-token', 'idempotency-key', 'authorization'],
    allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    maxAge: 600,
  }));
  app.use('*', rateLimit(ipLimiter, (c) => `ip:${clientIp(c, trustProxy)}`));
  app.use('/v1/payment-intents/*', rateLimit(keyLimiter, (c) => rateKey(c, clientIp(c, trustProxy))));
  app.use('/v1/payment-intents', rateLimit(keyLimiter, (c) => rateKey(c, clientIp(c, trustProxy))));
  app.use('/v1/payments', rateLimit(keyLimiter, (c) => rateKey(c, clientIp(c, trustProxy))));

  // Only order creation is limited tightly; status polling is covered by the global per-IP limit.
  app.post('/demo/orders', demoOrderLimit);

  app.get('/health', (c) => {
    const net = getNetwork(deps.config.ACQUI_NETWORK);
    return c.json({
      ok: true,
      service: 'acqui-api',
      network: { id: net.id, chainId: net.chainId },
      contracts: deps.contracts ? { configured: true, distributor: deps.contracts.distributor } : { configured: false },
      config: describeConfig(deps.config),
    });
  });

  app.route('/auth', authRoutes(deps, authLimiter));
  app.route('/v1/merchant', merchantRoutes(deps));
  app.route('/v1', paymentRoutes(deps));
  app.route('/public', publicRoutes(deps));
  app.route('/demo', demoRoutes(deps));
  return app;
}
