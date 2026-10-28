// arc-studio-allow-onchain-literal (test fixtures: fake chain scripted in memory, no real funds)
/** Worker test helpers: a scripted chain, a scripted keeper chain, and builders for real-shaped logs and receipts. */
import { encodeAbiParameters, encodeEventTopics, getAddress, keccak256, pad, toHex, type Hex } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { ARC_TESTNET, distributorAbi, erc20TransferAbi, NATIVE_WEI_PER_USDC_UNIT, type Address } from '@acqui/shared';
import { createAlerts } from './alerts';
import type { KeeperChain, ReceiptInfo, SignedTx, SimulateResult } from './chain';
import type { IntentRow, KeeperCtx } from './keeper';
import { TRANSFER_TOPIC } from './logs';
import { silentLogger, type ChainSource, type RawLog } from './types';
import { DISTRIBUTOR, USDC, type Harness } from '../../api/src/testing';

export const EMITTER = ARC_TESTNET.nativeTransferEmitter;
export const ZERO_ADDRESS_FOR_FROM = getAddress('0x0000000000000000000000000000000000000001');

export function transferLog(emitter: Address, from: Address, to: Address, value: bigint, txHash: Hex, logIndex: number): Omit<RawLog, 'blockNumber'> {
  return { address: emitter, logIndex, transactionHash: txHash, topics: [TRANSFER_TOPIC, pad(from), pad(to)], data: toHex(value, { size: 32 }) };
}

/** A scripted chain with deterministic blocks. Timestamps are unix seconds. */
export class FakeSource implements ChainSource {
  chainId = ARC_TESTNET.chainId;
  blocks: { number: bigint; ts: bigint; logs: RawLog[] }[] = [];
  calls: [bigint, bigint][] = [];
  failNext = 0;
  private txCounter = 0;

  constructor(startNumber = 100n, startTs = 1_700_000_000n) {
    this.blocks.push({ number: startNumber, ts: startTs, logs: [] });
  }
  get head(): bigint { return this.blocks[this.blocks.length - 1]?.number ?? 0n; }
  get headTs(): bigint { return this.blocks[this.blocks.length - 1]?.ts ?? 0n; }
  newTx(): Hex { this.txCounter += 1; return keccak256(toHex(`tx-${this.txCounter}-${Math.random()}`)); }

  /** Mines one block with the given timestamp and logs. */
  mine(ts: bigint, logs: Omit<RawLog, 'blockNumber'>[] = []): bigint {
    const number = this.head + 1n;
    this.blocks.push({ number, ts, logs: logs.map((l) => ({ ...l, blockNumber: number })) });
    return number;
  }
  /** Plain native send: only the system emitter logs it (18 decimals). */
  nativeSend(ts: bigint, to: Address, units: bigint, dustWei = 0n, from = ZERO_ADDRESS_FOR_FROM): Hex {
    const tx = this.newTx();
    this.mine(ts, [transferLog(EMITTER, from, to, units * NATIVE_WEI_PER_USDC_UNIT + dustWei, tx, 0)]);
    return tx;
  }
  /** ERC-20 transfer(): the USDC contract logs 6 decimals AND the system emitter logs 18 decimals for the same movement. */
  erc20Send(ts: bigint, to: Address, units: bigint, from = ZERO_ADDRESS_FOR_FROM): Hex {
    const tx = this.newTx();
    this.mine(ts, [transferLog(USDC, from, to, units, tx, 0), transferLog(EMITTER, from, to, units * NATIVE_WEI_PER_USDC_UNIT, tx, 1)]);
    return tx;
  }
  idle(ts: bigint, count = 1): void { for (let i = 0; i < count; i += 1) this.mine(ts + BigInt(i)); }

  getHead = () => Promise.resolve(this.head);
  getTransferLogs(from: bigint, to: bigint): Promise<RawLog[]> {
    this.calls.push([from, to]);
    if (this.failNext > 0) { this.failNext -= 1; return Promise.reject(new Error('rpc unavailable')); }
    // The real RPC returns logs from both emitters; the scanner asks the system emitter only.
    return Promise.resolve(this.blocks.filter((b) => b.number >= from && b.number <= to).flatMap((b) => b.logs).filter((l) => l.address === EMITTER));
  }
  getBlockTimestamp(n: bigint): Promise<bigint> {
    const b = this.blocks.find((x) => x.number === n);
    return b ? Promise.resolve(b.ts) : Promise.reject(new Error(`unknown block ${n}`));
  }
}

export class FakeKeeper implements KeeperChain {
  chainId = ARC_TESTNET.chainId;
  keeperAddress = getAddress('0x00000000000000000000000000000000000ee001');
  balanceWei = 10n ** 18n;
  usdc = new Map<string, bigint>();
  settled = new Set<string>();
  simQueue: SimulateResult[] = [];
  broadcasts: Hex[] = [];
  broadcastError: Error | null = null;
  receipts = new Map<string, ReceiptInfo>();
  pending = new Set<string>();
  settledLogs = new Map<string, RawLog>();
  verifyOk = true;
  headNumber = 1000n;
  headTimestamp = 1_700_000_000n;
  /** Called on broadcast so a test can mine a receipt for that exact transaction. */
  onBroadcast: ((raw: Hex, hash: Hex) => void) | null = null;
  private counter = 0;

  head = () => Promise.resolve({ number: this.headNumber, timestamp: this.headTimestamp });
  keeperBalanceWei = () => Promise.resolve(this.balanceWei);
  usdcBalance = (a: Address) => Promise.resolve(this.usdc.get(a.toLowerCase()) ?? 0n);
  isSettledOnchain = (r: Address) => Promise.resolve(this.settled.has(r.toLowerCase()));
  findSettledLog = (r: Address) => Promise.resolve(this.settledLogs.get(r.toLowerCase()) ?? null);
  verifyDeposit = () => Promise.resolve(this.verifyOk);
  simulate(): Promise<SimulateResult> { return Promise.resolve(this.simQueue.shift() ?? { ok: true, gas: 300_000n }); }
  prepare(_data: Hex, gas: bigint): Promise<SignedTx> {
    this.counter += 1;
    const raw = toHex(`raw-${this.counter}-${Math.random()}`);
    return Promise.resolve({ raw, hash: keccak256(raw), nonce: this.counter, maxCostWei: gas * 20n * 10n ** 9n });
  }
  broadcast(raw: Hex): Promise<void> {
    if (this.broadcastError) return Promise.reject(this.broadcastError);
    this.broadcasts.push(raw);
    this.onBroadcast?.(raw, keccak256(raw));
    return Promise.resolve();
  }
  getReceipt = (hash: Hex) => Promise.resolve(this.receipts.get(hash.toLowerCase()) ?? null);
  isKnownPending = (hash: Hex) => Promise.resolve(this.pending.has(hash.toLowerCase()));
}

/** A receipt shaped exactly like a successful settle(): PaymentSettled from the distributor and the USDC payout leg. */
export function settleReceipt(i: IntentRow, over: { status?: 'success' | 'reverted'; blockNumber?: bigint; net?: bigint; omitPayout?: boolean; omitEvent?: boolean } = {}): ReceiptInfo {
  const receiver = getAddress(i.receiver_address);
  const merchant = getAddress(i.payout_address);
  const net = over.net ?? BigInt(i.merchant_net_units);
  const settledTopics = encodeEventTopics({ abi: distributorAbi, eventName: 'PaymentSettled', args: { receiver, intentId: i.intent_ref, merchant } }) as Hex[];
  const settledData = encodeAbiParameters(
    [{ type: 'bytes32' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'address' }, { type: 'uint64' }, { type: 'bytes32' }, { type: 'uint64' }],
    [i.attempt_ref, BigInt(i.gross_units), BigInt(i.protocol_fee_units), BigInt(i.keeper_reimbursement_units), net, getAddress('0x00000000000000000000000000000000000ee001'), 1n, pad('0x01'), 1n],
  );
  const transferTopics = encodeEventTopics({ abi: erc20TransferAbi, eventName: 'Transfer', args: { from: receiver, to: merchant } }) as Hex[];
  const logs: ReceiptInfo['logs'][number][] = [];
  if (!over.omitPayout) logs.push({ address: USDC, topics: transferTopics, data: encodeAbiParameters([{ type: 'uint256' }], [net]), logIndex: 0 });
  if (!over.omitEvent) logs.push({ address: DISTRIBUTOR, topics: settledTopics, data: settledData, logIndex: 3 });
  return { status: over.status ?? 'success', blockNumber: over.blockNumber ?? 500n, gasUsed: 250_000n, effectiveGasPrice: 20n * 10n ** 9n, logs };
}

export function recoveredReceipt(i: IntentRow, amount: bigint, status: 'success' | 'reverted' = 'success'): ReceiptInfo {
  const topics = encodeEventTopics({ abi: distributorAbi, eventName: 'FundsRecovered', args: { receiver: getAddress(i.receiver_address), intentId: i.intent_ref, refundAddress: getAddress(i.refund_address) } }) as Hex[];
  const data = encodeAbiParameters([{ type: 'uint256' }, { type: 'bool' }, { type: 'address' }], [amount, false, getAddress('0x00000000000000000000000000000000000ee001')]);
  return { status, blockNumber: 600n, gasUsed: 120_000n, effectiveGasPrice: 20n * 10n ** 9n, logs: [{ address: DISTRIBUTOR, topics, data, logIndex: 1 }] };
}

export const attesterAccount = privateKeyToAccount(generatePrivateKey());

export function keeperCtx(h: Harness, chain: FakeKeeper, over: Partial<KeeperCtx['config']> = {}): KeeperCtx & { alertsRaised: string[] } {
  const raised: string[] = [];
  const alerts = createAlerts({ log: silentLogger, now: () => h.clock.now, cooldownMs: 0, send: (p) => { raised.push(p.code); return Promise.resolve(); } });
  return {
    db: h.db, chain, attester: attesterAccount, alerts, log: silentLogger, now: () => h.clock.now, sleep: () => Promise.resolve(),
    contracts: { chainId: ARC_TESTNET.chainId, distributor: DISTRIBUTOR, usdc: USDC, recoveryDelaySeconds: 86_400n },
    config: { CONFIRMATIONS: 1, MIN_KEEPER_BALANCE_WEI: 2n * 10n ** 18n / 1_000n, STUCK_SETTLEMENT_ALERT_SECONDS: 300, ...over },
    alertsRaised: raised,
  };
}

export const unixOf = (d: Date): bigint => BigInt(Math.floor(d.getTime() / 1000));
