import { createServer } from 'node:http';
import { defineChain, getAddress } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { ConfigError, describeConfig, getNetwork, loadWorkerConfig, NATIVE_WEI_PER_USDC_UNIT } from '@acqui/shared';
import { verifyDeployment } from '../../api/src/chain';
import { createDb, migrate } from '../../api/src/db';
import { createAlerts, createWebhookAlertSender } from './alerts';
import { buildTransport, createChainSource, createKeeperChain, createRpcPublicClient } from './chain';
import { evaluateIntent, type EvalCtx } from './evaluate';
import { keeperTick, type KeeperCtx } from './keeper';
import { startLoop, type LoopState } from './loops';
import { reconcileTick } from './reconcile';
import { recoveryTick } from './recovery';
import { loadCursor, scanOnce } from './scanner';
import { consoleLogger } from './types';
import { createSafePoster } from './webhooks';

const LEADER_LOCK_KEY = 727_273;
const log = consoleLogger;
const now = () => new Date();
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** RPC order: managed proxy (Arc Studio sandboxes), configured primary, configured fallbacks, then the public endpoint. */
function rpcUrls(configured: string | undefined, fallbacks: string | undefined, publicUrls: readonly string[]): string[] {
  const urls: string[] = [];
  const proxyChains = (process.env.RPC_PROXY_CHAINS ?? '').split(',');
  if (process.env.RPC_PROXY_BASE_URL && proxyChains.includes('Arc_Testnet')) {
    urls.push(`${process.env.RPC_PROXY_BASE_URL}/api/rpc/Arc_Testnet?_rpc_token=${process.env.RPC_PROXY_TOKEN ?? ''}`);
  }
  if (configured) urls.push(configured);
  urls.push(...(fallbacks ?? '').split(',').map((u) => u.trim()).filter(Boolean));
  urls.push(...publicUrls);
  return [...new Set(urls)];
}

async function main(): Promise<void> {
  let config: ReturnType<typeof loadWorkerConfig>;
  try {
    config = loadWorkerConfig(process.env);
  } catch (error) {
    if (error instanceof ConfigError) {
      console.error(error.message);
      process.exit(1);
    }
    throw error;
  }
  const network = getNetwork(config.ACQUI_NETWORK);

  // Liveness comes up first so a platform health check passes while migrations run or while a newer deployment waits
  // for the previous worker to release the leader lock. It reports full loop status once the loops are running.
  let report: (() => Promise<{ ok: boolean; body: Record<string, unknown> }>) | null = null;
  let phase: 'starting' | 'waiting_for_leader' | 'running' = 'starting';
  const server = createServer((req, res) => {
    void (async () => {
      if (req.url !== '/health') { res.writeHead(404).end(); return; }
      const out = report ? await report() : { ok: true, body: { ok: true, phase } };
      res.writeHead(out.ok ? 200 : 503, { 'content-type': 'application/json' }).end(JSON.stringify(out.body));
    })();
  });
  // Railway injects PORT for the service; HEALTH_PORT is the fallback for other hosts.
  server.listen(Number(process.env.PORT) || config.HEALTH_PORT);

  const db = createDb(config.DATABASE_URL, 8);
  await migrate(db);

  const urls = rpcUrls(config.ARC_RPC_URL, config.ARC_RPC_FALLBACK_URLS, network.publicRpcUrls);
  const chain = defineChain({
    id: network.chainId, name: network.name, nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
    rpcUrls: { default: { http: urls } },
  });
  const client = createRpcPublicClient(urls, chain);
  void buildTransport;

  // Refuse to run against anything that is not a verified Acqui deployment on the expected chain.
  const contracts = await verifyDeployment(client, config.ACQUI_NETWORK, config.DISTRIBUTOR_ADDRESS);
  const keeper = privateKeyToAccount(config.KEEPER_PRIVATE_KEY);
  const attester = privateKeyToAccount(config.ATTESTER_PRIVATE_KEY);
  if (getAddress(attester.address) !== contracts.attester) {
    console.error('ATTESTER_PRIVATE_KEY does not control the distributor ATTESTER. Refusing to start.');
    process.exit(1);
  }
  if (keeper.address === attester.address) {
    console.error('KEEPER_PRIVATE_KEY and ATTESTER_PRIVATE_KEY must be different keys. Refusing to start.');
    process.exit(1);
  }

  const alerts = createAlerts({ log, now, ...(config.ALERT_WEBHOOK_URL ? { send: createWebhookAlertSender(config.ALERT_WEBHOOK_URL) } : {}) });
  const minBalanceWei = config.MIN_KEEPER_BALANCE_USDC * NATIVE_WEI_PER_USDC_UNIT;
  const keeperChain = createKeeperChain({
    client, chain, distributor: contracts.distributor, usdc: contracts.usdc, keeperKey: config.KEEPER_PRIVATE_KEY,
    maxFeePerGasWei: BigInt(config.MAX_FEE_PER_GAS_GWEI) * 1_000_000_000n, minFeePerGasWei: 20n * 1_000_000_000n,
    emitter: network.nativeTransferEmitter,
  });
  const source = createChainSource(client, network.chainId, network.nativeTransferEmitter, log);

  // One active worker at a time: a session advisory lock on a dedicated connection. If it is ever lost, exit and restart.
  const lockConn = await db.reserve();
  phase = 'waiting_for_leader';
  for (;;) {
    const got = await lockConn<{ ok: boolean }[]>`SELECT pg_try_advisory_lock(${LEADER_LOCK_KEY}) AS ok`;
    if (got[0]?.ok) break;
    log.warn('worker_waiting_for_leader_lock', {});
    await sleep(10_000);
  }
  setInterval(() => { void lockConn`SELECT 1`.catch(() => { log.error('leader_lock_lost', {}); process.exit(1); }); }, 15_000).unref();

  const evalCtx: EvalCtx = { db, chainId: network.chainId, recoveryDelaySeconds: contracts.recoveryDelaySeconds, log, now };
  const keeperCtx: KeeperCtx = {
    db, chain: keeperChain, attester, alerts, log, now, sleep,
    contracts: { chainId: network.chainId, distributor: contracts.distributor, usdc: contracts.usdc, recoveryDelaySeconds: contracts.recoveryDelaySeconds, deployBlock: config.DISTRIBUTOR_DEPLOY_BLOCK },
    config: { CONFIRMATIONS: config.CONFIRMATIONS, MIN_KEEPER_BALANCE_WEI: minBalanceWei, STUCK_SETTLEMENT_ALERT_SECONDS: config.STUCK_SETTLEMENT_ALERT_SECONDS },
  };
  const states: Record<string, LoopState> = {};
  const state = (name: string): LoopState => (states[name] = { name, lastSuccessAt: null, consecutiveErrors: 0, lastError: null });
  const controller = new AbortController();
  const common = { signal: controller.signal, log, alerts, now };

  const loops = [
    startLoop({
      ...common, name: 'scanner', intervalMs: config.SCAN_INTERVAL_MS, state: state('scanner'),
      run: async () => {
        // Catch up without sleeping while there is a backlog.
        for (let i = 0; i < 50; i += 1) {
          const result = await scanOnce({ db, source, config, emitter: network.nativeTransferEmitter, log, now });
          if (!result) return;
          for (const id of result.touchedIntents) await evaluateIntent(evalCtx, id);
          if (result.scannedTo >= result.head) return;
        }
      },
    }),
    startLoop({
      ...common, name: 'keeper', intervalMs: config.KEEPER_INTERVAL_MS, state: state('keeper'),
      run: async () => {
        await keeperTick(keeperCtx);
        await recoveryTick({
          db, chain: keeperChain, contracts: { chainId: network.chainId, distributor: contracts.distributor },
          autoExecute: config.RECOVERY_AUTOEXECUTE === 'true', minBalanceWei, alerts, log, now, sleep,
        });
      },
    }),
    startLoop({
      ...common, name: 'reconcile', intervalMs: config.RECONCILE_INTERVAL_MS, state: state('reconcile'),
      run: () => reconcileTick({
        db, chainId: network.chainId, evalCtx, keeperChain, alerts, log, now,
        delivery: {
          db, encryptionKey: config.WEBHOOK_SECRET_ENCRYPTION_KEY, post: createSafePoster(), production: config.NODE_ENV === 'production', now, log,
          onFailure: (code, message, details) => alerts.raise(`${code}:${String(details.deliveryId)}`, message, details),
        },
        config: { CURSOR_LAG_ALERT_SECONDS: config.CURSOR_LAG_ALERT_SECONDS, MIN_KEEPER_BALANCE_WEI: minBalanceWei },
      }),
    }),
  ];

  phase = 'running';
  report = async () => {
    const cursor = await loadCursor(db, network.chainId).catch(() => null);
    const ok = Object.values(states).every((s) => s.consecutiveErrors < 3);
    return {
      ok,
      body: {
        ok, phase, network: network.id, chainId: network.chainId, loops: states,
        cursor: cursor && { lastBlock: cursor.last_block, watermark: cursor.last_block_timestamp, headBlock: cursor.head_block },
        alerts: alerts.active(),
      },
    };
  };
  log.info('acqui_worker_started', { chainId: network.chainId, keeper: keeper.address, ...describeConfig(config) });

  const stop = () => { controller.abort(); server.close(); };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
  await Promise.all(loops);
  lockConn.release();
  await db.end({ timeout: 5 });
}

main().catch((error: unknown) => {
  console.error('worker crashed', error instanceof Error ? error.message : 'unknown');
  process.exit(1);
});
