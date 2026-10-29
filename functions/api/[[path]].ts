import { proxyToApi, type ProxyEnv } from '../../edge/proxy';

// Cloudflare Pages Function: every /api/* request goes to the Northflank API (see docs/DEPLOY_NORTHFLANK_CLOUDFLARE.md).
export const onRequest = (context: { request: Request; env: ProxyEnv }): Promise<Response> => proxyToApi(context.request, context.env);
