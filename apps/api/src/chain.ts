import { createPublicClient, getAddress, http, parseAbi, type PublicClient } from 'viem';
import { deriveFactoryAddress, deriveReceiverAddress, distributorAbi, factoryAbi, type Address, type NetworkId, getNetwork } from '@acqui/shared';
import type { ChainReader, ContractsInfo } from './context';

const blocklistAbi = parseAbi(['function isBlacklisted(address account) view returns (bool)']);

export function createRpcClient(rpcUrl: string): PublicClient {
  return createPublicClient({ transport: http(rpcUrl) });
}

export function createChainReader(client: PublicClient, usdc: Address): ChainReader {
  return {
    isBlacklisted: (address) => client.readContract({ address: usdc, abi: blocklistAbi, functionName: 'isBlacklisted', args: [address] }),
  };
}

/**
 * Proves the configured address is a real PaymentDistributor for this network before any intent is accepted:
 * chain id, USDC, immutables, and that our offline factory/receiver derivation equals the contracts' own.
 * Throws with a specific reason; the API then keeps refusing intents instead of serving wrong receivers.
 */
export async function verifyDeployment(client: PublicClient, network: NetworkId, distributor: Address): Promise<ContractsInfo> {
  const net = getNetwork(network);
  const chainId = await client.getChainId();
  if (chainId !== net.chainId) throw new Error(`RPC chain id ${chainId} does not match ${net.id} (${net.chainId})`);
  const code = await client.getCode({ address: distributor });
  if (!code || code === '0x') throw new Error('No contract code at DISTRIBUTOR_ADDRESS');

  const read = <T>(fn: string) => client.readContract({ address: distributor, abi: distributorAbi, functionName: fn as never }) as Promise<T>;
  const [deployedChainId, usdc, attester, feeSafe, factory, maxReimb, delay] = await Promise.all([
    read<bigint>('DEPLOYED_CHAIN_ID'), read<Address>('USDC'), read<Address>('ATTESTER'), read<Address>('FEE_SAFE'),
    read<Address>('FACTORY'), read<bigint>('MAX_KEEPER_REIMBURSEMENT'), read<bigint>('RECOVERY_DELAY'),
  ]);
  if (Number(deployedChainId) !== net.chainId) throw new Error('Distributor was deployed on a different chain');
  if (getAddress(usdc) !== getAddress(net.usdcErc20)) throw new Error('Distributor USDC does not match the network USDC address');
  if (getAddress(factory) !== deriveFactoryAddress(distributor)) throw new Error('Factory address differs from the offline derivation');

  const probe = `0x${'5a'.repeat(32)}` as const;
  const onchain = await client.readContract({ address: factory, abi: factoryAbi, functionName: 'predictReceiver', args: [probe] });
  if (getAddress(onchain) !== deriveReceiverAddress(distributor, probe)) {
    throw new Error('Receiver derivation differs from the factory: run `bun run contracts:codegen`');
  }
  return {
    chainId, distributor: getAddress(distributor), factory: getAddress(factory), usdc: getAddress(usdc),
    attester: getAddress(attester), feeSafe: getAddress(feeSafe), maxKeeperReimbursement: maxReimb, recoveryDelaySeconds: delay,
  };
}
