/**
 * Live Arc RPC verification for Acqui. Read-only. Run: `bun run verify:chain`.
 * Checks chain ID, USDC ERC-20 code/decimals, and the native system emitter's log behavior,
 * then writes docs/chain-verification-arc-testnet.json. Mainnet is not supported by this script yet.
 */
import { createPublicClient, http, parseAbi, type Log } from 'viem';
import { writeFileSync } from 'node:fs';
import { ARC_TESTNET } from '../packages/shared/src/chains';

const net = ARC_TESTNET;

function resolveRpcUrl(): { url: string; via: string } {
  const base = process.env.RPC_PROXY_BASE_URL;
  const chains = (process.env.RPC_PROXY_CHAINS ?? '').split(',');
  if (process.env.ARC_RPC_URL) return { url: process.env.ARC_RPC_URL, via: 'ARC_RPC_URL' };
  if (base && chains.includes('Arc_Testnet')) {
    return { url: `${base}/api/rpc/Arc_Testnet?_rpc_token=${process.env.RPC_PROXY_TOKEN ?? ''}`, via: 'rpc-proxy' };
  }
  const fallback = net.publicRpcUrls[0];
  if (!fallback) throw new Error('No RPC URL available');
  return { url: fallback, via: 'public-fallback' };
}

interface Result {
  id: string;
  ok: boolean;
  detail: string;
}

const erc20Abi = parseAbi(['function decimals() view returns (uint8)', 'function symbol() view returns (string)']);
/** Small window: the system emitter is busy and the RPC caps results per query. */
const LOOKBACK = 150n;
const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

async function main(): Promise<void> {
  const rpc = resolveRpcUrl();
  const client = createPublicClient({ transport: http(rpc.url) });
  const results: Result[] = [];

  const chainId = await client.getChainId();
  results.push({ id: 'chain-id', ok: chainId === net.chainId, detail: `eth_chainId=${chainId}, expected ${net.chainId}` });

  const code = await client.getCode({ address: net.usdcErc20 });
  const decimals = await client.readContract({ address: net.usdcErc20, abi: erc20Abi, functionName: 'decimals' });
  const symbol = await client.readContract({ address: net.usdcErc20, abi: erc20Abi, functionName: 'symbol' });
  results.push({
    id: 'usdc-erc20',
    ok: Boolean(code && code !== '0x') && decimals === 6,
    detail: `code=${code && code !== '0x' ? 'present' : 'missing'}, decimals=${decimals}, symbol=${symbol}`,
  });

  const head = await client.getBlockNumber();
  const from = head > LOOKBACK ? head - LOOKBACK : 0n; // bounded lookback, never genesis
  const emitterLogs = await client.request({
    method: 'eth_getLogs',
    params: [{ address: net.nativeTransferEmitter, topics: [TRANSFER_TOPIC], fromBlock: `0x${from.toString(16)}`, toBlock: `0x${head.toString(16)}` }],
  }) as Log[];
  results.push({
    id: 'native-emitter',
    ok: emitterLogs.length > 0,
    detail: `${emitterLogs.length} system Transfer logs in blocks ${from}-${head} (inconclusive if 0: widen the window)`,
  });

  const erc20Logs = await client.request({
    method: 'eth_getLogs',
    params: [{ address: net.usdcErc20, topics: [TRANSFER_TOPIC], fromBlock: `0x${from.toString(16)}`, toBlock: `0x${head.toString(16)}` }],
  }) as Log[];
  const sysTx = new Set(emitterLogs.map((l) => l.transactionHash));
  const both = erc20Logs.filter((l) => l.transactionHash && sysTx.has(l.transactionHash));
  results.push({
    id: 'double-log',
    ok: both.length > 0,
    detail: `${both.length}/${erc20Logs.length} ERC-20 Transfer txs also carry a system log (inconclusive if 0)`,
  });

  const report = { network: net.id, checkedAt: new Date().toISOString(), rpcVia: rpc.via, head: head.toString(), results };
  writeFileSync(new URL('../docs/chain-verification-arc-testnet.json', import.meta.url), JSON.stringify(report, null, 2) + '\n');
  for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.id}: ${r.detail}`);
  console.log('Not yet checked by script: finality depth, 20 gwei fee floor (see docs/OPEN_QUESTIONS.md)');
  if (results.some((r) => !r.ok)) process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
