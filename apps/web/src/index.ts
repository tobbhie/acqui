import { resolve } from 'node:path';
import { serve } from '@hono/node-server';
import { createWebApp } from './server';

const apiBaseUrl = process.env.API_INTERNAL_URL;
if (!apiBaseUrl) {
  console.error('API_INTERNAL_URL is required, for example http://api.railway.internal:8080');
  process.exit(1);
}
const port = Number(process.env.PORT) || 3000;
const app = createWebApp({ distDir: resolve(process.env.WEB_DIST_DIR ?? 'dist'), apiBaseUrl });
serve({ fetch: app.fetch, port });
console.log(`acqui-web listening on :${port}, forwarding /api to ${new URL(apiBaseUrl).origin}`);
