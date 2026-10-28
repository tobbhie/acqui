import { serve } from '@hono/node-server';
import { ConfigError, getNetwork, loadApiConfig } from '@acqui/shared';
import { createApp } from './app';
import { createGoogleAuth } from './auth/google';
import { createChainReader, createRpcClient, verifyDeployment } from './chain';
import type { AppDeps } from './context';
import { createDb, migrate } from './db';
import { createMailer } from './mailer';

const VERIFY_RETRY_MS = 30_000;

function resolveRpcUrl(chainKey: string, configured: string | undefined, fallback: string | undefined): string {
  if (configured) return configured;
  const proxyChains = (process.env.RPC_PROXY_CHAINS ?? '').split(',');
  if (process.env.RPC_PROXY_BASE_URL && proxyChains.includes(chainKey)) {
    return `${process.env.RPC_PROXY_BASE_URL}/api/rpc/${chainKey}?_rpc_token=${process.env.RPC_PROXY_TOKEN ?? ''}`;
  }
  if (!fallback) throw new Error('No RPC URL available');
  return fallback;
}

async function main(): Promise<void> {
  let config: ReturnType<typeof loadApiConfig>;
  try {
    config = loadApiConfig(process.env);
  } catch (error) {
    if (error instanceof ConfigError) {
      console.error(error.message);
      process.exit(1);
    }
    throw error;
  }

  const network = getNetwork(config.ACQUI_NETWORK);
  const db = createDb(config.DATABASE_URL);
  const applied = await migrate(db);
  if (applied.length > 0) console.log('applied migrations', applied);

  const rpcUrl = resolveRpcUrl('Arc_Testnet', config.ARC_RPC_URL, network.publicRpcUrls[0]);
  const client = createRpcClient(rpcUrl);
  const deps: AppDeps = {
    db,
    config,
    googleAuth: createGoogleAuth({ clientId: config.GOOGLE_CLIENT_ID, clientSecret: config.GOOGLE_CLIENT_SECRET, redirectUri: config.GOOGLE_REDIRECT_URI }),
    mailer: createMailer(config),
    chain: createChainReader(client, network.usdcErc20),
    contracts: null,
    now: () => new Date(),
  };

  const distributor = config.DISTRIBUTOR_ADDRESS;
  if (distributor) {
    const attempt = async (): Promise<void> => {
      try {
        deps.contracts = await verifyDeployment(client, config.ACQUI_NETWORK, distributor);
        console.log('contracts verified', { distributor, chainId: deps.contracts.chainId });
      } catch (error) {
        deps.contracts = null;
        console.error('contract verification failed, payment intents refused:', error instanceof Error ? error.message : 'unknown');
        setTimeout(() => void attempt(), VERIFY_RETRY_MS).unref();
      }
    };
    await attempt();
  } else {
    console.warn('DISTRIBUTOR_ADDRESS not set: payment intents are refused until contracts are configured');
  }

  const app = createApp(deps);
  serve({ fetch: app.fetch, port: config.PORT }, (info) => console.log(`acqui-api listening on :${info.port}`));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
