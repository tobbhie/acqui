/**
 * Offline derivation of Acqui contract addresses. No RPC needed.
 *   factory  = CREATE(distributor, nonce 1)   (the distributor constructor deploys it as its first contract)
 *   receiver = CREATE2(factory, salt = termsHash, initcode = receiverCreationCode ++ abi.encode(distributor, termsHash))
 * Both are re-verified against the chain by `verifyDeployment` in apps/api before intents are accepted.
 */
import { concatHex, encodeAbiParameters, getAddress, getContractAddress, keccak256, type Address, type Hex } from 'viem';
import { PAYMENT_RECEIVER_CREATION_CODE } from './receiver-bytecode';

/** The factory is the first contract created by the distributor, so its CREATE nonce is 1 (EIP-161). */
export function deriveFactoryAddress(distributor: Address): Address {
  return getContractAddress({ from: distributor, nonce: 1n });
}

export function deriveReceiverAddress(distributor: Address, termsHash: Hex): Address {
  const factory = deriveFactoryAddress(distributor);
  const initCode = concatHex([
    PAYMENT_RECEIVER_CREATION_CODE,
    encodeAbiParameters([{ type: 'address' }, { type: 'bytes32' }], [distributor, termsHash]),
  ]);
  const hash = keccak256(concatHex(['0xff', factory, termsHash, keccak256(initCode)]));
  return getAddress(`0x${hash.slice(26)}`);
}
