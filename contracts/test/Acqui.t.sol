// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Vm} from "forge-std/Vm.sol";
import {AcquiTestBase} from "./Acqui.Base.t.sol";
import {Terms} from "../AcquiTerms.sol";
import {PaymentDistributor} from "../PaymentDistributor.sol";

/// Settlement happy paths, windows, funding shapes and terms validation.
contract AcquiSettleTest is AcquiTestBase {
    // ---------- happy path ----------

    function test_Settle_TenUsdcExample() public {
        Terms memory t = _defaultTerms();
        address r = _fund(t, AMOUNT);
        PaymentDistributor.SettlementEvidence memory e = _onTimeEv(t);
        bytes memory sig = _sign(attesterPk, t, e);

        vm.recordLogs();
        vm.prank(keeper);
        dist.settle(t, e, sig);

        assertEq(usdc.balanceOf(merchant), 9_880_000, "merchant net 9.88");
        assertEq(usdc.balanceOf(keeper), 20_000, "keeper 0.02");
        assertEq(usdc.balanceOf(address(dist)), 100_000, "fee 0.10");
        assertEq(usdc.balanceOf(r), 0, "receiver drained");

        (bool settled, uint256 gross, uint256 fee, uint256 reimb, uint256 net) = dist.settlements(r);
        assertTrue(settled);
        assertEq(gross, AMOUNT);
        assertEq(fee, 100_000);
        assertEq(reimb, 20_000);
        assertEq(net, 9_880_000);
        assertEq(dist.accruedFees(), 100_000);
        assertEq(dist.totalFeesAccrued(), 100_000);
        assertEq(dist.totalGrossSettled(), AMOUNT);
        assertTrue(factory.isRegistered(r));
    }

    function test_Settle_EmitsPaymentSettled() public {
        Terms memory t = _defaultTerms();
        address r = _fund(t, AMOUNT);
        PaymentDistributor.SettlementEvidence memory e = _onTimeEv(t);
        bytes memory sig = _sign(attesterPk, t, e);

        vm.recordLogs();
        vm.prank(keeper);
        dist.settle(t, e, sig);
        (bool found, Vm.Log memory log, Settled memory s) = _findSettled(vm.getRecordedLogs());

        assertTrue(found, "event missing");
        assertEq(address(uint160(uint256(log.topics[1]))), r);
        assertEq(log.topics[2], t.intentId);
        assertEq(address(uint160(uint256(log.topics[3]))), merchant);
        assertEq(s.attemptId, t.attemptId);
        assertEq(s.gross, AMOUNT);
        assertEq(s.fee, 100_000);
        assertEq(s.keeperReimbursement, 20_000);
        assertEq(s.merchantNet, 9_880_000);
        assertEq(s.keeper, keeper);
        assertEq(s.depositTimestamp, e.depositTimestamp);
        assertEq(s.evidenceTxHash, e.evidenceTxHash);
        assertEq(s.evidenceBlock, e.evidenceBlock);
    }

    function test_Settle_ZeroReimbursementSkipsKeeperTransfer() public {
        Terms memory t = _defaultTerms();
        t.keeperReimbursement = 0;
        _fundAndSettle(t);
        assertEq(usdc.balanceOf(keeper), 0);
        assertEq(usdc.balanceOf(merchant), 9_900_000);
        assertEq(usdc.balanceOf(address(dist)), 100_000);
    }

    function test_Settle_CounterfactualDepositBeforeDeployment() public {
        // Simulates a native send to the not-yet-deployed receiver: balance exists before code does.
        Terms memory t = _defaultTerms();
        address r = _receiver(t);
        assertEq(r.code.length, 0);
        usdc.mint(r, AMOUNT);
        assertEq(usdc.balanceOf(r), AMOUNT);
        assertFalse(factory.isRegistered(r));

        _settleSigned(t);

        assertGt(r.code.length, 0, "settle deploys receiver");
        assertTrue(factory.isRegistered(r));
        assertEq(usdc.balanceOf(merchant), 9_880_000);
    }

    function test_Settle_PermissionlessSubmitterGetsReimbursement() public {
        // reimbursement goes to msg.sender, never tx.origin
        Terms memory t = _defaultTerms();
        _fund(t, AMOUNT);
        PaymentDistributor.SettlementEvidence memory e = _onTimeEv(t);
        bytes memory sig = _sign(attesterPk, t, e);
        vm.prank(anyone, keeper);
        dist.settle(t, e, sig);
        assertEq(usdc.balanceOf(anyone), MAX_REIMB);
        assertEq(usdc.balanceOf(keeper), 0);
    }

    // ---------- minimum payment ----------

    function test_MinimumPayment_OneUsdcSettles() public {
        Terms memory t = _terms(keccak256("min"), 1e6);
        _fundAndSettle(t);
        assertEq(usdc.balanceOf(merchant), 880_000);
        assertEq(usdc.balanceOf(keeper), 20_000);
        assertEq(usdc.balanceOf(address(dist)), 100_000);
    }

    function test_Revert_BelowMinimumPayment() public {
        Terms memory t = _terms(keccak256("below"), 999_999);
        PaymentDistributor.SettlementEvidence memory e = _onTimeEv(t);
        bytes memory sig = _sign(attesterPk, t, e);
        vm.expectRevert(PaymentDistributor.AmountBelowMinimum.selector);
        dist.settle(t, e, sig);
    }

    // ---------- 30 minute boundary / windows ----------

    function test_Boundary_DepositAtExpiryAccepted() public {
        Terms memory t = _defaultTerms();
        _fund(t, AMOUNT);
        PaymentDistributor.SettlementEvidence memory e = _ev(t, expiry);
        bytes memory sig = _sign(attesterPk, t, e);
        vm.warp(expiry);
        dist.settle(t, e, sig);
        assertEq(usdc.balanceOf(merchant), 9_880_000);
    }

    function test_Boundary_DepositOneSecondAfterExpiryRejected() public {
        Terms memory t = _defaultTerms();
        _fund(t, AMOUNT);
        PaymentDistributor.SettlementEvidence memory e = _ev(t, expiry + 1);
        bytes memory sig = _sign(attesterPk, t, e);
        vm.warp(expiry + 1);
        vm.expectRevert(PaymentDistributor.DepositAfterExpiry.selector);
        dist.settle(t, e, sig);
    }

    function test_Boundary_SettlementWindowClosesAfterExpiryPlusDelay() public {
        Terms memory t = _defaultTerms();
        _fund(t, AMOUNT);
        PaymentDistributor.SettlementEvidence memory e = _onTimeEv(t);
        bytes memory sig = _sign(attesterPk, t, e);

        vm.warp(uint256(expiry) + DELAY + 1);
        vm.expectRevert(PaymentDistributor.SettlementWindowClosed.selector);
        dist.settle(t, e, sig);

        // exactly at expiry + DELAY the window is still open
        vm.warp(uint256(expiry) + DELAY);
        dist.settle(t, e, sig);
        assertEq(usdc.balanceOf(merchant), 9_880_000);
    }

    function test_Revert_DepositTimestampInFuture() public {
        Terms memory t = _defaultTerms();
        _fund(t, AMOUNT);
        PaymentDistributor.SettlementEvidence memory e = _ev(t, expiry - 60);
        bytes memory sig = _sign(attesterPk, t, e);
        vm.warp(expiry - 120);
        vm.expectRevert(PaymentDistributor.InvalidTerms.selector);
        dist.settle(t, e, sig);
    }

    // ---------- funding shapes ----------

    function test_PartialPaymentThenTopUp() public {
        Terms memory t = _defaultTerms();
        address r = _fund(t, 6e6);
        PaymentDistributor.SettlementEvidence memory e = _onTimeEv(t);
        bytes memory sig = _sign(attesterPk, t, e);

        vm.expectRevert(PaymentDistributor.InsufficientReceiverBalance.selector);
        dist.settle(t, e, sig);

        usdc.mint(r, 4e6);
        vm.prank(keeper);
        dist.settle(t, e, sig);
        assertEq(usdc.balanceOf(merchant), 9_880_000);
        assertEq(usdc.balanceOf(r), 0);
    }

    function test_Revert_UnderpaymentByOneBaseUnit() public {
        Terms memory t = _defaultTerms();
        _fund(t, AMOUNT - 1);
        PaymentDistributor.SettlementEvidence memory e = _onTimeEv(t);
        bytes memory sig = _sign(attesterPk, t, e);
        vm.expectRevert(PaymentDistributor.InsufficientReceiverBalance.selector);
        dist.settle(t, e, sig);
    }

    function test_Revert_LateTopUpMeansEligibleBelowAmount() public {
        // 6 USDC on time, 4 USDC after expiry: attester signs eligible = 6 -> cannot settle.
        Terms memory t = _defaultTerms();
        _fund(t, AMOUNT);
        PaymentDistributor.SettlementEvidence memory e = _onTimeEv(t);
        e.eligibleAmount = 6e6;
        bytes memory sig = _sign(attesterPk, t, e);
        vm.expectRevert(PaymentDistributor.InsufficientEligibleAmount.selector);
        dist.settle(t, e, sig);
    }

    function test_Overpayment_SettlesOnlyInvoiceGross() public {
        Terms memory t = _defaultTerms();
        address r = _fund(t, 15e6);
        _settleSigned(t);
        assertEq(usdc.balanceOf(merchant), 9_880_000);
        assertEq(usdc.balanceOf(keeper), 20_000);
        assertEq(usdc.balanceOf(address(dist)), 100_000);
        assertEq(usdc.balanceOf(r), 5e6, "excess stays in receiver");
        (, uint256 gross,,,) = dist.settlements(r);
        assertEq(gross, AMOUNT);
        assertEq(dist.totalGrossSettled(), AMOUNT);
    }

    // ---------- terms validation ----------

    function test_Revert_ZeroMerchantOrRefund() public {
        Terms memory t = _defaultTerms();
        t.merchant = address(0);
        vm.expectRevert(PaymentDistributor.ZeroAddress.selector);
        dist.recover(t);

        t = _defaultTerms();
        t.refundAddress = address(0);
        vm.expectRevert(PaymentDistributor.ZeroAddress.selector);
        dist.recover(t);
    }

    function test_Revert_MerchantOrRefundIsDistributorOrFactory() public {
        Terms memory t = _defaultTerms();
        t.merchant = address(dist);
        vm.expectRevert(PaymentDistributor.InvalidTerms.selector);
        dist.recover(t);

        t = _defaultTerms();
        t.merchant = address(factory);
        vm.expectRevert(PaymentDistributor.InvalidTerms.selector);
        dist.recover(t);

        t = _defaultTerms();
        t.refundAddress = address(dist);
        vm.expectRevert(PaymentDistributor.InvalidTerms.selector);
        dist.recover(t);

        t = _defaultTerms();
        t.refundAddress = address(factory);
        vm.expectRevert(PaymentDistributor.InvalidTerms.selector);
        dist.recover(t);
    }

    function test_Revert_BadFeeParamsOrExpiry() public {
        Terms memory t = _defaultTerms();
        t.feeBps = 11;
        vm.expectRevert(PaymentDistributor.InvalidTerms.selector);
        dist.recover(t);

        t = _defaultTerms();
        t.minFee = 99_999;
        vm.expectRevert(PaymentDistributor.InvalidTerms.selector);
        dist.recover(t);

        t = _defaultTerms();
        t.expiry = 0;
        vm.expectRevert(PaymentDistributor.InvalidTerms.selector);
        dist.recover(t);
    }

    function test_Revert_ReimbursementAboveMax() public {
        Terms memory t = _defaultTerms();
        t.keeperReimbursement = MAX_REIMB + 1;
        PaymentDistributor.SettlementEvidence memory e = _onTimeEv(t);
        bytes memory sig = _sign(attesterPk, t, e);
        vm.expectRevert(PaymentDistributor.KeeperReimbursementTooHigh.selector);
        dist.settle(t, e, sig);
    }

    function test_HashTerms_IsChainBound() public {
        Terms memory t = _defaultTerms();
        bytes32 h1 = dist.hashTerms(t);
        vm.chainId(999);
        assertNotEq(dist.hashTerms(t), h1);
    }
}
