import { ARC_TESTNET, NATIVE_WEI_PER_USDC_UNIT, type Address } from '@acqui/shared';
import { getAddress } from 'viem';
import type { Deposit, RawLog } from './types';

export const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

/**
 * Turns raw logs into deposits, counting each economic movement exactly once.
 *
 * Arc emits an 18-decimal EIP-7708 `Transfer` from the system emitter for EVERY USDC movement (native sends,
 * ERC-20 transfers, mints, burns). An ERC-20 `transfer()` additionally emits a 6-decimal log from the USDC contract.
 * Counting both would double every ERC-20 payment, and counting only the ERC-20 log would miss plain native sends,
 * so only the system emitter is trusted and every other emitter is ignored here, whatever it claims.
 */
export function decodeDeposits(logs: readonly RawLog[], systemEmitter: Address = ARC_TESTNET.nativeTransferEmitter): Deposit[] {
  const out: Deposit[] = [];
  const emitter = systemEmitter.toLowerCase();
  for (const log of logs) {
    if (log.address.toLowerCase() !== emitter) continue;
    if (log.topics.length !== 3 || log.topics[0] !== TRANSFER_TOPIC) continue;
    const [, fromTopic, toTopic] = log.topics;
    if (!fromTopic || !toTopic || log.data === '0x') continue;
    const wei = BigInt(log.data);
    const units = wei / NATIVE_WEI_PER_USDC_UNIT;
    if (units === 0n) continue; // zero or pure dust: invisible to the ERC-20 view, nothing spendable
    out.push({
      txHash: log.transactionHash,
      logIndex: log.logIndex,
      blockNumber: log.blockNumber,
      from: topicToAddress(fromTopic),
      to: topicToAddress(toTopic),
      amountUnits: units,
      dustWei: wei % NATIVE_WEI_PER_USDC_UNIT,
    });
  }
  return out;
}

function topicToAddress(topic: string): Address {
  return getAddress(`0x${topic.slice(26)}`);
}
