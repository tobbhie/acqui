import { requireChain } from '../../../src/onchain-facts';
import type { Address, NetworkId } from './types';

export type VerificationStatus = 'unverified' | 'verified';

export interface VerificationItem {
  id: string;
  description: string;
  /** Flip to 'verified' only after `bun run verify:chain` or a manual check proves it. */
  status: VerificationStatus;
  source: string;
}

export interface AcquiNetworkConfig {
  id: NetworkId;
  chainId: number;
  name: string;
  isMainnet: boolean;
  /** ERC-20 view of USDC: 6 decimals. All Acqui accounting uses this view. */
  usdcErc20: Address;
  usdcErc20Decimals: 6;
  /** Native / gas view of USDC: 18 decimals. Only for gas and raw native transfer logs. */
  nativeDecimals: 18;
  /** Emits the 18-decimal native USDC Transfer log (EIP-7708) for every USDC movement. */
  nativeTransferEmitter: Address;
  explorerBase: string;
  /** Public fallback only. Production uses a managed RPC from ARC_RPC_URL. */
  publicRpcUrls: readonly string[];
  /** Arc has deterministic finality. Confirmation depth is still a Step 04 decision. */
  confirmations: number | null;
  verification: readonly VerificationItem[];
}

const DOCS = 'https://docs.arc.io/arc/references';

const testnetFacts = requireChain(5042002);
if (!testnetFacts.usdc) throw new Error('Arc Studio registry has no USDC for Arc Testnet');

export const ARC_TESTNET: AcquiNetworkConfig = {
  id: 'arc-testnet',
  chainId: testnetFacts.chainId,
  name: testnetFacts.name,
  isMainnet: false,
  usdcErc20: testnetFacts.usdc.address as Address,
  usdcErc20Decimals: 6,
  nativeDecimals: 18,
  nativeTransferEmitter: '0xffffFFFfFFffffffffffffffFfFFFfffFFFfFFfE',
  explorerBase: testnetFacts.explorerBase,
  publicRpcUrls: testnetFacts.rpcUrls,
  confirmations: null,
  verification: [
    { id: 'chain-id', description: 'eth_chainId returns 5042002', status: 'verified', source: `${DOCS}/rpc-endpoints.md` },
    { id: 'usdc-erc20', description: 'USDC ERC-20 has code and decimals() == 6', status: 'verified', source: `${DOCS}/contract-addresses.md` },
    { id: 'native-emitter', description: 'System emitter logs 18-decimal Transfer for USDC movements', status: 'verified', source: `${DOCS}/usdc-system-events.md` },
    { id: 'double-log', description: 'One ERC-20 transfer() emits two logs (6 and 18 decimals): count once', status: 'verified', source: `${DOCS}/usdc-system-events.md` },
    { id: 'finality', description: 'Deterministic finality: depth required before settlement', status: 'unverified', source: 'https://docs.arc.io/arc/concepts/deterministic-finality.md' },
    { id: 'fee-floor', description: 'maxFeePerGas floor of 20 gwei applies to keeper transactions', status: 'unverified', source: `${DOCS}/evm-differences.md` },
  ],
};

/**
 * Arc mainnet is intentionally absent. It is unlocked only after the user has acknowledged the
 * mainnet warning and every item in the mainnet verification checklist (see docs/OPEN_QUESTIONS.md).
 */
export const NETWORKS: Readonly<Record<NetworkId, AcquiNetworkConfig>> = {
  'arc-testnet': ARC_TESTNET,
};

export function getNetwork(id: NetworkId): AcquiNetworkConfig {
  return NETWORKS[id];
}
