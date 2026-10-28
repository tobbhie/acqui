/**
 * TypeScript mirror of the Solidity ABI surface and hashing (contracts/AcquiTerms.sol,
 * contracts/PaymentDistributor.sol). Integer amounts only. Any change to the Solidity structs
 * must change this file and its tests.
 */
import { encodeAbiParameters, keccak256, parseAbi, stringToHex, type TypedDataDomain } from 'viem';
import { MIN_GATEWAY_FEE, GATEWAY_FEE_BPS } from './policy';
import type { Address, Hex } from './types';

/** Immutable checkout attempt terms. Mirrors `struct Terms`. */
export interface ContractTerms {
  intentId: Hex;
  attemptId: Hex;
  merchant: Address;
  refundAddress: Address;
  amount: bigint;
  expiry: bigint;
  feeBps: number;
  minFee: bigint;
  keeperReimbursement: bigint;
}

/** Attested deposit evidence. Mirrors `struct SettlementEvidence`. */
export interface SettlementEvidence {
  eligibleAmount: bigint;
  depositTimestamp: bigint;
  evidenceTxHash: Hex;
  evidenceBlock: bigint;
}

export const TERMS_TYPE =
  'Terms(uint256 chainId,bytes32 intentId,bytes32 attemptId,address merchant,address refundAddress,uint256 amount,uint64 expiry,uint16 feeBps,uint256 minFee,uint256 keeperReimbursement)';

export const TERMS_TYPEHASH: Hex = keccak256(stringToHex(TERMS_TYPE));

export const DISTRIBUTOR_EIP712_NAME = 'AcquiPaymentDistributor';
export const DISTRIBUTOR_EIP712_VERSION = '1';

/** Terms with the protocol fee policy that the distributor enforces. */
export function protocolFeeTerms(): Pick<ContractTerms, 'feeBps' | 'minFee'> {
  return { feeBps: Number(GATEWAY_FEE_BPS), minFee: MIN_GATEWAY_FEE };
}

/** Chain-bound terms hash. Must equal `PaymentDistributor.hashTerms` on the target chain. */
export function hashTerms(chainId: bigint, t: ContractTerms): Hex {
  return keccak256(
    encodeAbiParameters(
      [
        { type: 'bytes32' },
        { type: 'uint256' },
        { type: 'bytes32' },
        { type: 'bytes32' },
        { type: 'address' },
        { type: 'address' },
        { type: 'uint256' },
        { type: 'uint64' },
        { type: 'uint16' },
        { type: 'uint256' },
        { type: 'uint256' },
      ],
      [
        TERMS_TYPEHASH,
        chainId,
        t.intentId,
        t.attemptId,
        t.merchant,
        t.refundAddress,
        t.amount,
        t.expiry,
        t.feeBps,
        t.minFee,
        t.keeperReimbursement,
      ],
    ),
  );
}

/** EIP-712 payload the attester signs. The contract recomputes `termsHash` itself. */
export function settlementTypedData(
  domain: { chainId: bigint; verifyingContract: Address },
  termsHash: Hex,
  e: SettlementEvidence,
) {
  const typedDomain: TypedDataDomain = {
    name: DISTRIBUTOR_EIP712_NAME,
    version: DISTRIBUTOR_EIP712_VERSION,
    chainId: domain.chainId,
    verifyingContract: domain.verifyingContract,
  };
  return {
    domain: typedDomain,
    types: {
      Settlement: [
        { name: 'termsHash', type: 'bytes32' },
        { name: 'eligibleAmount', type: 'uint256' },
        { name: 'depositTimestamp', type: 'uint64' },
        { name: 'evidenceTxHash', type: 'bytes32' },
        { name: 'evidenceBlock', type: 'uint64' },
      ],
    },
    primaryType: 'Settlement' as const,
    message: {
      termsHash,
      eligibleAmount: e.eligibleAmount,
      depositTimestamp: e.depositTimestamp,
      evidenceTxHash: e.evidenceTxHash,
      evidenceBlock: e.evidenceBlock,
    },
  };
}

const TERMS_STRUCT =
  'struct Terms { bytes32 intentId; bytes32 attemptId; address merchant; address refundAddress; uint256 amount; uint64 expiry; uint16 feeBps; uint256 minFee; uint256 keeperReimbursement; }';
const EVIDENCE_STRUCT =
  'struct SettlementEvidence { uint256 eligibleAmount; uint64 depositTimestamp; bytes32 evidenceTxHash; uint64 evidenceBlock; }';

/** Native (gas) wei per ERC-20 USDC base unit on Arc: 18 native decimals vs 6 ERC-20 decimals. */
export const NATIVE_WEI_PER_USDC_UNIT = 1_000_000_000_000n;

export const distributorAbi = parseAbi([
  TERMS_STRUCT,
  EVIDENCE_STRUCT,
  'error ZeroAddress()',
  'error InvalidTerms()',
  'error AmountBelowMinimum()',
  'error KeeperReimbursementTooHigh()',
  'error SettlementWindowClosed()',
  'error DepositAfterExpiry()',
  'error InsufficientEligibleAmount()',
  'error InvalidAttestation()',
  'error AlreadySettled()',
  'error InsufficientReceiverBalance()',
  'error RecoveryNotOpen()',
  'error NothingToRecover()',
  'error NothingToCollect()',
  'error ReentrancyGuardReentrantCall()',
  'function USDC() view returns (address)',
  'function ATTESTER() view returns (address)',
  'function FEE_SAFE() view returns (address)',
  'function FACTORY() view returns (address)',
  'function DEPLOYED_CHAIN_ID() view returns (uint256)',
  'function MAX_KEEPER_REIMBURSEMENT() view returns (uint256)',
  'function RECOVERY_DELAY() view returns (uint64)',
  'function accruedFees() view returns (uint256)',
  'function computeFee(uint256 amount) pure returns (uint256)',
  'function previewSettlement(uint256 amount, uint256 keeperReimbursement) view returns (uint256 fee, uint256 merchantNet)',
  'function hashTerms(Terms t) view returns (bytes32)',
  'function predictReceiver(Terms t) view returns (address)',
  'function settlementDigest(Terms t, SettlementEvidence e) view returns (bytes32)',
  'function settlements(address receiver) view returns (bool settled, uint256 gross, uint256 fee, uint256 keeperReimbursement, uint256 merchantNet)',
  'function settle(Terms t, SettlementEvidence e, bytes signature)',
  'function recover(Terms t) returns (uint256 amount)',
  'function collectFees() returns (uint256 amount)',
  'event PaymentSettled(address indexed receiver, bytes32 indexed intentId, address indexed merchant, bytes32 attemptId, uint256 gross, uint256 fee, uint256 keeperReimbursement, uint256 merchantNet, address keeper, uint64 depositTimestamp, bytes32 evidenceTxHash, uint64 evidenceBlock)',
  'event FundsRecovered(address indexed receiver, bytes32 indexed intentId, address indexed refundAddress, uint256 amount, bool afterSettlement, address caller)',
  'event FeesCollected(address indexed feeSafe, uint256 amount, uint256 accountedFees)',
]);

/** Standard ERC-20 Transfer, used to confirm the payout leg inside a settlement receipt. */
export const erc20TransferAbi = parseAbi(['event Transfer(address indexed from, address indexed to, uint256 value)']);

export const factoryAbi = parseAbi([
  'function distributor() view returns (address)',
  'function predictReceiver(bytes32 termsHash) view returns (address)',
  'function deployReceiver(bytes32 termsHash) returns (address)',
  'function isRegistered(address receiver) view returns (bool)',
]);
