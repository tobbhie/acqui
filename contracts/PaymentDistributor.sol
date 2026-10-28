// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {SignatureChecker} from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {Terms, AcquiTerms} from "./AcquiTerms.sol";
import {PaymentFactory} from "./PaymentFactory.sol";
import {PaymentReceiver} from "./PaymentReceiver.sol";

/// @notice Immutable, attestation-gated USDC settlement with permissionless refunds and fee collection.
/// @dev Deploy with Arc USDC at 0x3600000000000000000000000000000000000000.
/// No native receive/fallback is exposed. All accounting uses the ERC-20 balance view.
/// Non-USDC tokens and sub-1e-6 native dust in receivers are not recoverable.
/// A blocklisted refund destination makes recovery revert; no alternate destination exists.
contract PaymentDistributor is EIP712, ReentrancyGuard {
    using SafeERC20 for IERC20;

    error ZeroAddress();
    error InvalidTerms();
    error AmountBelowMinimum();
    error KeeperReimbursementTooHigh();
    error SettlementWindowClosed();
    error DepositAfterExpiry();
    error InsufficientEligibleAmount();
    error InvalidAttestation();
    error AlreadySettled();
    error InsufficientReceiverBalance();
    error RecoveryNotOpen();
    error NothingToRecover();
    error NothingToCollect();
    error AttesterEqualsFeeSafe();
    error TokenWithoutCode();
    error InvalidTokenDecimals();
    error InvalidRecoveryDelay();

    /// @notice The ERC-20 USDC interface used for all accounting and transfers.
    IERC20 public immutable USDC;
    /// @notice Immutable EOA or ERC-1271 settlement attester.
    address public immutable ATTESTER;
    /// @notice Sole destination for collected fees and accidental distributor transfers.
    address public immutable FEE_SAFE;
    /// @notice Factory deployed exclusively for this distributor's receivers.
    PaymentFactory public immutable FACTORY;
    /// @notice Chain ID at deployment.
    uint256 public immutable DEPLOYED_CHAIN_ID;
    /// @notice Maximum fixed reimbursement allowed in checkout terms.
    uint256 public immutable MAX_KEEPER_REIMBURSEMENT;
    /// @notice Grace period between invoice expiry and unsettled recovery opening.
    uint64 public immutable RECOVERY_DELAY;

    uint256 public constant MIN_PAYMENT = 1_000_000;
    uint256 public constant MIN_FEE = 100_000;
    uint16 public constant FEE_BPS = 10;
    uint256 public constant BPS_DENOMINATOR = 10_000;

    bytes32 private constant SETTLEMENT_TYPEHASH = keccak256(
        "Settlement(bytes32 termsHash,uint256 eligibleAmount,uint64 depositTimestamp,bytes32 evidenceTxHash,uint64 evidenceBlock)"
    );

    struct SettlementRecord {
        bool settled;
        uint256 gross;
        uint256 fee;
        uint256 keeperReimbursement;
        uint256 merchantNet;
    }

    struct SettlementEvidence {
        uint256 eligibleAmount;
        uint64 depositTimestamp;
        bytes32 evidenceTxHash;
        uint64 evidenceBlock;
    }

    /// @notice One-way settlement record per receiver.
    mapping(address receiver => SettlementRecord) public settlements;
    /// @notice Cumulative refunded USDC per receiver, including repeated recoveries.
    mapping(address receiver => uint256) public recoveredAmount;
    /// @notice Settlement fees not yet collected.
    uint256 public accruedFees;
    /// @notice Lifetime fees accrued from settlements.
    uint256 public totalFeesAccrued;
    /// @notice Lifetime amount collected, including accidental transfers.
    uint256 public totalFeesCollected;
    /// @notice Lifetime invoice gross settled, excluding overpayment.
    uint256 public totalGrossSettled;

    /// @notice Records immutable configuration and the newly deployed factory.
    event DistributorDeployed(
        address indexed factory,
        uint256 chainId,
        address usdc,
        address attester,
        address feeSafe,
        uint256 maxKeeperReimbursement,
        uint64 recoveryDelay
    );

    /// @notice Records a completed invoice settlement and its attested deposit evidence.
    event PaymentSettled(
        address indexed receiver,
        bytes32 indexed intentId,
        address indexed merchant,
        bytes32 attemptId,
        uint256 gross,
        uint256 fee,
        uint256 keeperReimbursement,
        uint256 merchantNet,
        address keeper,
        uint64 depositTimestamp,
        bytes32 evidenceTxHash,
        uint64 evidenceBlock
    );

    /// @notice Records a full ERC-20-view receiver refund to the committed destination.
    event FundsRecovered(
        address indexed receiver,
        bytes32 indexed intentId,
        address indexed refundAddress,
        uint256 amount,
        bool afterSettlement,
        address caller
    );

    /// @notice Records the full distributor balance swept to the immutable fee Safe.
    /// @param feeSafe Fixed recipient of the transfer.
    /// @param amount Actual USDC collected, including accidental transfers.
    /// @param accountedFees Accrued settlement fees cleared by this collection.
    event FeesCollected(address indexed feeSafe, uint256 amount, uint256 accountedFees);

    /// @notice Validate and permanently fix the gateway configuration, then deploy its factory.
    constructor(
        IERC20 usdc,
        address attester,
        address feeSafe,
        uint256 maxKeeperReimbursement,
        uint64 recoveryDelay
    ) EIP712("AcquiPaymentDistributor", "1") {
        if (address(usdc) == address(0) || attester == address(0) || feeSafe == address(0)) {
            revert ZeroAddress();
        }
        if (attester == feeSafe) revert AttesterEqualsFeeSafe();
        if (address(usdc).code.length == 0) revert TokenWithoutCode();
        try IERC20Metadata(address(usdc)).decimals() returns (uint8 decimals_) {
            if (decimals_ != 6) revert InvalidTokenDecimals();
        } catch {
            revert InvalidTokenDecimals();
        }
        if (maxKeeperReimbursement > MIN_FEE) revert KeeperReimbursementTooHigh();
        if (recoveryDelay < 1 hours || recoveryDelay > 30 days) revert InvalidRecoveryDelay();

        USDC = usdc;
        ATTESTER = attester;
        FEE_SAFE = feeSafe;
        DEPLOYED_CHAIN_ID = block.chainid;
        MAX_KEEPER_REIMBURSEMENT = maxKeeperReimbursement;
        RECOVERY_DELAY = recoveryDelay;
        PaymentFactory factory = new PaymentFactory(address(this));
        FACTORY = factory;
        emit DistributorDeployed(
            address(factory), block.chainid, address(usdc), attester, feeSafe,
            maxKeeperReimbursement, recoveryDelay
        );
    }

    /// @notice Return the greater of the minimum fee and the proportional fee rounded upward.
    function computeFee(uint256 amount) public pure returns (uint256) {
        return Math.max(MIN_FEE, Math.mulDiv(amount, FEE_BPS, BPS_DENOMINATOR, Math.Rounding.Ceil));
    }

    /// @notice Preview fee and strictly positive merchant proceeds under the configured limits.
    function previewSettlement(uint256 amount, uint256 keeperReimbursement)
        public view returns (uint256 fee, uint256 merchantNet)
    {
        if (amount < MIN_PAYMENT) revert AmountBelowMinimum();
        if (keeperReimbursement > MAX_KEEPER_REIMBURSEMENT) revert KeeperReimbursementTooHigh();
        fee = computeFee(amount);
        if (fee >= amount || keeperReimbursement >= amount - fee) revert InvalidTerms();
        merchantNet = amount - fee - keeperReimbursement;
    }

    /// @notice Return the canonical chain-bound hash without validating the supplied terms.
    function hashTerms(Terms calldata t) public view returns (bytes32) {
        return AcquiTerms.hash(t);
    }

    /// @notice Predict the deterministic receiver for the supplied terms without deploying it.
    function predictReceiver(Terms calldata t) public view returns (address) {
        return FACTORY.predictReceiver(AcquiTerms.hash(t));
    }

    /// @notice Return the EIP-712 digest binding recomputed terms and all settlement evidence.
    function settlementDigest(Terms calldata t, SettlementEvidence calldata e) public view returns (bytes32) {
        return _hashTypedDataV4(keccak256(abi.encode(
            SETTLEMENT_TYPEHASH,
            AcquiTerms.hash(t),
            e.eligibleAmount,
            e.depositTimestamp,
            e.evidenceTxHash,
            e.evidenceBlock
        )));
    }

    /// @notice Settle exactly the invoice gross on valid attestation within the settlement window.
    /// @dev Excess remains in the receiver. The caller receives only the precommitted reimbursement.
    function settle(Terms calldata t, SettlementEvidence calldata e, bytes calldata signature)
        external nonReentrant
    {
        _validate(t);
        if (block.timestamp > uint256(t.expiry) + RECOVERY_DELAY) revert SettlementWindowClosed();
        if (e.depositTimestamp > t.expiry) revert DepositAfterExpiry();
        if (e.depositTimestamp > block.timestamp) revert InvalidTerms();
        if (e.eligibleAmount < t.amount) revert InsufficientEligibleAmount();
        if (!SignatureChecker.isValidSignatureNow(ATTESTER, settlementDigest(t, e), signature)) {
            revert InvalidAttestation();
        }
        address receiver = FACTORY.deployReceiver(AcquiTerms.hash(t));
        if (settlements[receiver].settled) revert AlreadySettled();
        if (USDC.balanceOf(receiver) < t.amount) revert InsufficientReceiverBalance();

        (uint256 fee, uint256 merchantNet) = previewSettlement(t.amount, t.keeperReimbursement);
        settlements[receiver] = SettlementRecord({
            settled: true,
            gross: t.amount,
            fee: fee,
            keeperReimbursement: t.keeperReimbursement,
            merchantNet: merchantNet
        });
        accruedFees += fee;
        totalFeesAccrued += fee;
        totalGrossSettled += t.amount;

        PaymentReceiver payableReceiver = PaymentReceiver(payable(receiver));
        payableReceiver.pull(USDC, t.merchant, merchantNet);
        if (t.keeperReimbursement != 0) {
            payableReceiver.pull(USDC, msg.sender, t.keeperReimbursement);
        }
        payableReceiver.pull(USDC, address(this), fee);
        _emitPaymentSettled(receiver, t, e);
    }

    /// @notice Refund all receiver USDC after settlement, or strictly after the unsettled grace period.
    /// @dev Permissionless and repeatable; no fee is taken and the refund destination cannot change.
    function recover(Terms calldata t) external nonReentrant returns (uint256 amount) {
        _validate(t);
        address receiver = FACTORY.deployReceiver(AcquiTerms.hash(t));
        bool afterSettlement = settlements[receiver].settled;
        if (!afterSettlement && block.timestamp <= uint256(t.expiry) + RECOVERY_DELAY) {
            revert RecoveryNotOpen();
        }
        amount = USDC.balanceOf(receiver);
        if (amount == 0) revert NothingToRecover();
        recoveredAmount[receiver] += amount;
        PaymentReceiver(payable(receiver)).pull(USDC, t.refundAddress, amount);
        emit FundsRecovered(receiver, t.intentId, t.refundAddress, amount, afterSettlement, msg.sender);
    }

    /// @notice Permissionlessly transfer the full distributor USDC balance only to FEE_SAFE.
    function collectFees() external nonReentrant returns (uint256 amount) {
        amount = USDC.balanceOf(address(this));
        if (amount == 0) revert NothingToCollect();
        uint256 accounted = accruedFees;
        accruedFees = 0;
        totalFeesCollected += amount;
        USDC.safeTransfer(FEE_SAFE, amount);
        emit FeesCollected(FEE_SAFE, amount, accounted);
    }

    function _validate(Terms calldata t) internal view {
        if (t.merchant == address(0) || t.refundAddress == address(0)) revert ZeroAddress();
        if (
            t.merchant == address(this) || t.refundAddress == address(this)
                || t.merchant == address(FACTORY) || t.refundAddress == address(FACTORY)
        ) revert InvalidTerms();
        if (t.amount < MIN_PAYMENT) revert AmountBelowMinimum();
        if (t.expiry == 0 || t.feeBps != FEE_BPS || t.minFee != MIN_FEE) revert InvalidTerms();
        if (t.keeperReimbursement > MAX_KEEPER_REIMBURSEMENT) revert KeeperReimbursementTooHigh();
        address receiver = predictReceiver(t);
        if (receiver == t.merchant || receiver == t.refundAddress) revert InvalidTerms();
        previewSettlement(t.amount, t.keeperReimbursement);
    }

    function _emitPaymentSettled(address receiver, Terms calldata t, SettlementEvidence calldata e) private {
        SettlementRecord storage record = settlements[receiver];
        emit PaymentSettled(
            receiver, t.intentId, t.merchant, t.attemptId,
            record.gross, record.fee, record.keeperReimbursement, record.merchantNet,
            msg.sender, e.depositTimestamp, e.evidenceTxHash, e.evidenceBlock
        );
    }
}
