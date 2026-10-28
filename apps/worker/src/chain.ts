import {
  createPublicClient, decodeErrorResult, encodeFunctionData, fallback, http, keccak256,
  type Chain, type PublicClient, type Transport,
} from 'viem';
import { privateKeyToAccount, type PrivateKeyAccount } from 'viem/accounts';
import { distributorAbi, type Address, type ContractTerms, type Hex, type SettlementEvidence } from '@acqui/shared';
import { TRANSFER_TOPIC } from './logs';
import type { ChainSource, Logger, RawLog } from './types';

/** Provider range/result limits come back as varied messages; any of these means "ask for a smaller range". */
const RANGE_ERROR = /(range|max results|too many|limit exceeded|more than|response size|query returned)/i;

export function buildTransport(urls: readonly string[]): Transport {
  const transports = urls.map((u) => http(u, { retryCount: 2, retryDelay: 300, timeout: 15_000 }));
  if (transports.length === 1) return transports[0];
  return fallback(transports, { retryCount: 1 });
}

export function createRpcPublicClient(urls: readonly string[], chain?: Chain): PublicClient {
  return createPublicClient({ transport: buildTransport(urls), ...(chain ? { chain } : {}) });
}

/** Scanner source: one eth_getLogs per range on the system emitter, split in half whenever the provider refuses a range. */
export function createChainSource(client: PublicClient, chainId: number, emitter: Address, log: Logger): ChainSource {
  const fetchRange = async (from: bigint, to: bigint, depth = 0): Promise<RawLog[]> => {
    try {
      const logs = await client.request({
        method: 'eth_getLogs',
        params: [{ address: emitter, topics: [TRANSFER_TOPIC], fromBlock: `0x${from.toString(16)}`, toBlock: `0x${to.toString(16)}` }],
      });
      return (logs as { address: Address; blockNumber: Hex; logIndex: Hex; transactionHash: Hex; topics: Hex[]; data: Hex }[]).map((l) => ({
        address: l.address, blockNumber: BigInt(l.blockNumber), logIndex: Number(BigInt(l.logIndex)),
        transactionHash: l.transactionHash, topics: l.topics, data: l.data,
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      if (from < to && depth < 12 && RANGE_ERROR.test(message)) {
        const mid = from + (to - from) / 2n;
        log.warn('scanner_range_split', { from: from.toString(), to: to.toString() });
        return [...(await fetchRange(from, mid, depth + 1)), ...(await fetchRange(mid + 1n, to, depth + 1))];
      }
      throw error;
    }
  };
  return {
    chainId,
    getHead: () => client.getBlockNumber(),
    getTransferLogs: (from, to) => fetchRange(from, to),
    getBlockTimestamp: async (n) => (await client.getBlock({ blockNumber: n })).timestamp,
  };
}

export type SettleErrorName =
  | 'InvalidTerms' | 'AmountBelowMinimum' | 'KeeperReimbursementTooHigh' | 'SettlementWindowClosed' | 'DepositAfterExpiry'
  | 'InsufficientEligibleAmount' | 'InvalidAttestation' | 'AlreadySettled' | 'InsufficientReceiverBalance'
  | 'RecoveryNotOpen' | 'NothingToRecover' | 'Unknown';

export type SimulateResult = { ok: true; gas: bigint } | { ok: false; error: SettleErrorName; detail: string };

export interface ReceiptInfo {
  status: 'success' | 'reverted';
  blockNumber: bigint;
  gasUsed: bigint;
  effectiveGasPrice: bigint;
  logs: readonly { address: Address; topics: readonly Hex[]; data: Hex; logIndex: number }[];
}

export interface SignedTx { raw: Hex; hash: Hex; nonce: number; maxCostWei: bigint }

/** Everything the keeper needs from the chain. A fake implements this in unit tests; viem implements it in production. */
export interface KeeperChain {
  chainId: number;
  keeperAddress: Address;
  head(): Promise<{ number: bigint; timestamp: bigint }>;
  keeperBalanceWei(): Promise<bigint>;
  usdcBalance(address: Address): Promise<bigint>;
  /** Contract view: has this receiver been settled onchain? */
  isSettledOnchain(receiver: Address): Promise<boolean>;
  /** Locates the PaymentSettled log for a receiver (crash recovery: payout happened but the DB does not know). */
  findSettledLog(receiver: Address, fromBlock: bigint): Promise<RawLog | null>;
  /** Re-reads the deposit's transaction: successful and carrying the expected system Transfer into the receiver. */
  verifyDeposit(d: { txHash: Hex; logIndex: number; receiver: Address; amountUnits: bigint }): Promise<boolean>;
  simulate(data: Hex): Promise<SimulateResult>;
  prepare(data: Hex, gas: bigint): Promise<SignedTx>;
  broadcast(raw: Hex): Promise<void>;
  getReceipt(hash: Hex): Promise<ReceiptInfo | null>;
  /** True when the node still knows the transaction (pending in the mempool). */
  isKnownPending(hash: Hex): Promise<boolean>;
}

export function revertName(error: unknown): { name: SettleErrorName; detail: string } {
  const detail = error instanceof Error ? error.message.slice(0, 300) : 'unknown';
  const text = error instanceof Error ? `${error.message} ${(error as { cause?: { data?: Hex } }).cause?.data ?? ''}` : '';
  const data = /0x[0-9a-fA-F]{8,}/.exec(text)?.[0] as Hex | undefined;
  if (data) {
    try {
      const decoded = decodeErrorResult({ abi: distributorAbi, data });
      return { name: decoded.errorName as SettleErrorName, detail };
    } catch { /* not a known error */ }
  }
  for (const candidate of ['AlreadySettled', 'SettlementWindowClosed', 'InsufficientReceiverBalance', 'InvalidAttestation', 'DepositAfterExpiry', 'InsufficientEligibleAmount', 'RecoveryNotOpen', 'NothingToRecover'] as const) {
    if (text.includes(candidate)) return { name: candidate, detail };
  }
  return { name: 'Unknown', detail };
}

export function createKeeperChain(opts: {
  client: PublicClient;
  chain: Chain;
  distributor: Address;
  usdc: Address;
  keeperKey: Hex;
  maxFeePerGasWei: bigint;
  minFeePerGasWei: bigint;
  emitter: Address;
}): KeeperChain {
  const account: PrivateKeyAccount = privateKeyToAccount(opts.keeperKey);
  const { client, distributor } = opts;
  const erc20 = [{ type: 'function', name: 'balanceOf', stateMutability: 'view', inputs: [{ name: '', type: 'address' }], outputs: [{ name: '', type: 'uint256' }] }] as const;

  return {
    chainId: opts.chain.id,
    keeperAddress: account.address,
    async head() {
      const block = await client.getBlock();
      return { number: block.number, timestamp: block.timestamp };
    },
    keeperBalanceWei: () => client.getBalance({ address: account.address }),
    usdcBalance: (address) => client.readContract({ address: opts.usdc, abi: erc20, functionName: 'balanceOf', args: [address] }),
    async isSettledOnchain(receiver) {
      const rec = await client.readContract({ address: distributor, abi: distributorAbi, functionName: 'settlements', args: [receiver] });
      return rec[0];
    },
    async findSettledLog(receiver, fromBlock) {
      const event = distributorAbi.find((i) => i.type === 'event' && i.name === 'PaymentSettled');
      if (!event || event.type !== 'event') return null;
      const logs = await client.getLogs({ address: distributor, event, args: { receiver }, fromBlock, toBlock: 'latest' });
      const l = logs[0];
      if (!l || l.blockNumber === null || l.logIndex === null || l.transactionHash === null) return null;
      return { address: l.address, blockNumber: l.blockNumber, logIndex: l.logIndex, transactionHash: l.transactionHash, topics: l.topics, data: l.data };
    },
    async verifyDeposit(d) {
      const receipt = await client.getTransactionReceipt({ hash: d.txHash }).catch(() => null);
      if (!receipt || receipt.status !== 'success') return false;
      const hit = receipt.logs.find((l) => l.logIndex === d.logIndex && l.address.toLowerCase() === opts.emitter.toLowerCase());
      if (!hit || hit.topics[0] !== TRANSFER_TOPIC || hit.topics.length !== 3) return false;
      return `0x${(hit.topics[2] ?? '').slice(26)}`.toLowerCase() === d.receiver.toLowerCase() && BigInt(hit.data) / 1_000_000_000_000n >= d.amountUnits;
    },
    async simulate(data) {
      try {
        await client.call({ account: account.address, to: distributor, data });
        const gas = await client.estimateGas({ account: account.address, to: distributor, data });
        return { ok: true, gas };
      } catch (error) {
        const { name, detail } = revertName(error);
        return { ok: false, error: name, detail };
      }
    },
    async prepare(data, gas) {
      const est = await client.estimateFeesPerGas();
      let maxFee = est.maxFeePerGas ?? opts.minFeePerGasWei;
      if (maxFee < opts.minFeePerGasWei) maxFee = opts.minFeePerGasWei; // Arc silently drops anything below its 20 gwei floor
      if (maxFee > opts.maxFeePerGasWei) throw new Error('network fee above MAX_FEE_PER_GAS_GWEI, refusing to send');
      const nonce = await client.getTransactionCount({ address: account.address, blockTag: 'pending' });
      const priority = est.maxPriorityFeePerGas ?? 0n;
      const raw = await account.signTransaction({
        type: 'eip1559', chainId: opts.chain.id, to: distributor, data, gas, nonce, value: 0n,
        maxFeePerGas: maxFee, maxPriorityFeePerGas: priority > maxFee ? maxFee : priority,
      });
      return { raw, hash: keccak256(raw), nonce, maxCostWei: gas * maxFee };
    },
    async broadcast(raw) {
      try {
        await client.sendRawTransaction({ serializedTransaction: raw });
      } catch (error) {
        // Re-broadcasting a known transaction is expected after a restart; only real failures propagate.
        if (!/already known|known transaction|nonce too low|already imported/i.test(error instanceof Error ? error.message : '')) throw error;
      }
    },
    async getReceipt(hash) {
      const r = await client.getTransactionReceipt({ hash }).catch(() => null);
      if (!r) return null;
      return {
        status: r.status, blockNumber: r.blockNumber, gasUsed: r.gasUsed, effectiveGasPrice: r.effectiveGasPrice,
        logs: r.logs.map((l) => ({ address: l.address, topics: l.topics, data: l.data, logIndex: l.logIndex })),
      };
    },
    async isKnownPending(hash) {
      const tx = await client.getTransaction({ hash }).catch(() => null);
      return tx !== null && tx.blockNumber === null;
    },
  };
}

export const encodeSettle = (terms: ContractTerms, evidence: SettlementEvidence, signature: Hex): Hex =>
  encodeFunctionData({ abi: distributorAbi, functionName: 'settle', args: [terms, evidence, signature] });

export const encodeRecover = (terms: ContractTerms): Hex =>
  encodeFunctionData({ abi: distributorAbi, functionName: 'recover', args: [terms] });
