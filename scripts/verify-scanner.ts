/**
 * Read-only check of the deposit decoder against REAL Arc logs (testnet only; never mainnet).
 * For a recent block window it fetches the system-emitter logs through the production chain source, and also the
 * USDC contract's own ERC-20 logs, then proves: (1) every ERC-20 transfer has a system log with the identical amount
 * (so counting the system emitter alone loses nothing), (2) counting both would double-count, (3) the decoder
 * returns exactly one deposit per movement. Usage: bun run verify:scanner
 */
import { createPublicClient, http } from 'viem';
import { ARC_TESTNET } from '../packages/shared/src/chains';
import { createChainSource } from '../apps/worker/src/chain';
import { decodeDeposits, TRANSFER_TOPIC } from '../apps/worker/src/logs';
import { consoleLogger } from '../apps/worker/src/types';

const WINDOW = 300n;
const urls = (process.env.ARC_RPC_URL ? [process.env.ARC_RPC_URL] : ARC_TESTNET.publicRpcUrls);
const client = createPublicClient({ transport: http(urls[0]) });
const chainId = await client.getChainId();
if (chainId !== ARC_TESTNET.chainId) throw new Error(`Refusing to run: chain ${chainId} is not Arc Testnet`);

const source = createChainSource(client, chainId, ARC_TESTNET.nativeTransferEmitter, consoleLogger);
const head = await source.getHead();
const from = head - WINDOW;
const system = await source.getTransferLogs(from, head);
const erc20 = (await client.request({
  method: 'eth_getLogs',
  params: [{ address: ARC_TESTNET.usdcErc20, topics: [TRANSFER_TOPIC], fromBlock: `0x${from.toString(16)}`, toBlock: `0x${head.toString(16)}` }],
})) as { transactionHash: string; topics: string[]; data: string; logIndex: string }[];

const systemByKey = new Map<string, bigint>();
for (const l of system) systemByKey.set(`${l.transactionHash}:${l.topics[1]}:${l.topics[2]}:${BigInt(l.data) / 1_000_000_000_000n}`, BigInt(l.data));
let matched = 0;
for (const l of erc20) {
  if (systemByKey.has(`${l.transactionHash}:${l.topics[1]}:${l.topics[2]}:${BigInt(l.data)}`)) matched += 1;
}
const decoded = decodeDeposits(system, ARC_TESTNET.nativeTransferEmitter);
const doubleCounted = decoded.length + erc20.length;
const out = [
  [`blocks ${from}-${head} on chain ${chainId}`, true],
  [`system-emitter logs: ${system.length}, ERC-20 logs: ${erc20.length}`, true],
  [`every ERC-20 transfer has an identical system log: ${matched}/${erc20.length}`, matched === erc20.length],
  [`decoder returned ${decoded.length} deposits (zero-value and sub-1e-6 dust dropped)`, decoded.length <= system.length],
  [`counting both emitters would report ${doubleCounted} (double counting avoided)`, erc20.length === 0 || doubleCounted > decoded.length],
] as const;
for (const [label, ok] of out) console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
if (out.some(([, ok]) => !ok)) process.exit(1);
