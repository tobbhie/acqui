import type { Address, Hex } from '@acqui/shared';

/** A log as returned by eth_getLogs (already hex-decoded numbers). */
export interface RawLog {
  address: Address;
  blockNumber: bigint;
  logIndex: number;
  transactionHash: Hex;
  topics: readonly Hex[];
  data: Hex;
}

/** One USDC movement into an address, normalized to ERC-20 base units. */
export interface Deposit {
  txHash: Hex;
  logIndex: number;
  blockNumber: bigint;
  from: Address;
  to: Address;
  /** 6-decimal ERC-20 view, rounded down exactly like `USDC.balanceOf` does. */
  amountUnits: bigint;
  /** Sub-1e-6 native remainder that the ERC-20 view cannot see. Never counted. */
  dustWei: bigint;
}

/** Read side of the chain used by the scanner. */
export interface ChainSource {
  chainId: number;
  getHead(): Promise<bigint>;
  /** Native-USDC system emitter Transfer logs in the inclusive range. Implementations split ranges on provider limits. */
  getTransferLogs(from: bigint, to: bigint): Promise<RawLog[]>;
  /** Unix seconds of the block's inclusion timestamp. */
  getBlockTimestamp(blockNumber: bigint): Promise<bigint>;
}

export interface Logger {
  info(event: string, fields?: Record<string, unknown>): void;
  warn(event: string, fields?: Record<string, unknown>): void;
  error(event: string, fields?: Record<string, unknown>): void;
}

export const consoleLogger: Logger = {
  info: (event, fields) => console.log(JSON.stringify({ level: 'info', event, ...fields })),
  warn: (event, fields) => console.warn(JSON.stringify({ level: 'warn', event, ...fields })),
  error: (event, fields) => console.error(JSON.stringify({ level: 'error', event, ...fields })),
};

export const silentLogger: Logger = { info: () => undefined, warn: () => undefined, error: () => undefined };
