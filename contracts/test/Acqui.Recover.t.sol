// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {AcquiTestBase} from "./Acqui.Base.t.sol";
import {Terms} from "../AcquiTerms.sol";
import {PaymentDistributor} from "../PaymentDistributor.sol";

/// Refund / recovery behaviour.
contract AcquiRecoverTest is AcquiTestBase {
    function test_Recover_LateDepositRefundedOnlyAfterDelay() public {
        Terms memory t = _defaultTerms();
        address r = _fund(t, AMOUNT);

        // deposit lands one second after expiry: attester evidence says depositTimestamp = expiry+1
        vm.warp(uint256(expiry) + 1);
        PaymentDistributor.SettlementEvidence memory e = _ev(t, expiry + 1);
        bytes memory sig = _sign(attesterPk, t, e);
        vm.expectRevert(PaymentDistributor.DepositAfterExpiry.selector);
        dist.settle(t, e, sig);

        // grace window: recovery closed, including exactly at expiry + DELAY
        vm.expectRevert(PaymentDistributor.RecoveryNotOpen.selector);
        dist.recover(t);
        vm.warp(uint256(expiry) + DELAY);
        vm.expectRevert(PaymentDistributor.RecoveryNotOpen.selector);
        dist.recover(t);

        // one second later: recovery open, settlement window closed (no overlap)
        vm.warp(uint256(expiry) + DELAY + 1);
        vm.expectRevert(PaymentDistributor.SettlementWindowClosed.selector);
        dist.settle(t, e, sig);

        vm.expectEmit(true, true, true, true, address(dist));
        emit PaymentDistributor.FundsRecovered(r, t.intentId, refund, AMOUNT, false, anyone);
        vm.prank(anyone);
        uint256 got = dist.recover(t);

        assertEq(got, AMOUNT);
        assertEq(usdc.balanceOf(refund), AMOUNT);
        assertEq(usdc.balanceOf(r), 0);
        assertEq(dist.recoveredAmount(r), AMOUNT);
        assertEq(usdc.balanceOf(merchant), 0);
        assertEq(usdc.balanceOf(address(dist)), 0, "no fee on recovery");
    }

    function test_Recover_NeverAvailableBeforeSettlementDuringGrace() public {
        Terms memory t = _defaultTerms();
        _fund(t, AMOUNT);
        uint256[4] memory times =
            [uint256(T0), uint256(expiry) - 1, uint256(expiry), uint256(expiry) + DELAY];
        for (uint256 i = 0; i < times.length; i++) {
            vm.warp(times[i]);
            vm.expectRevert(PaymentDistributor.RecoveryNotOpen.selector);
            dist.recover(t);
        }
        // payer's on-time payment can still be settled afterwards
        _settleSigned(t);
        assertEq(usdc.balanceOf(merchant), 9_880_000);
    }

    function test_Recover_OverpaymentImmediatelyAfterSettlement() public {
        Terms memory t = _defaultTerms();
        address r = _fund(t, 14e6);
        _settleSigned(t);
        assertEq(usdc.balanceOf(r), 4e6);

        vm.expectEmit(true, true, true, true, address(dist));
        emit PaymentDistributor.FundsRecovered(r, t.intentId, refund, 4e6, true, anyone);
        vm.prank(anyone);
        uint256 got = dist.recover(t); // still inside the grace window
        assertEq(got, 4e6);
        assertEq(usdc.balanceOf(refund), 4e6);
        assertEq(usdc.balanceOf(r), 0);
        // settlement amounts untouched
        assertEq(usdc.balanceOf(merchant), 9_880_000);
        assertEq(usdc.balanceOf(address(dist)), 100_000);
    }

    function test_Recover_RepeatedForLaterDeposits() public {
        Terms memory t = _defaultTerms();
        address r = _fund(t, 12e6);
        _settleSigned(t);

        dist.recover(t);
        assertEq(usdc.balanceOf(refund), 2e6);

        vm.expectRevert(PaymentDistributor.NothingToRecover.selector);
        dist.recover(t);

        usdc.mint(r, 3e6);
        vm.prank(keeper);
        dist.recover(t);
        usdc.mint(r, 1);
        dist.recover(t);

        assertEq(usdc.balanceOf(refund), 5e6 + 1);
        assertEq(dist.recoveredAmount(r), 5e6 + 1);
    }

    function test_Recover_NothingToRecover() public {
        Terms memory t = _defaultTerms();
        vm.warp(uint256(expiry) + DELAY + 1);
        vm.expectRevert(PaymentDistributor.NothingToRecover.selector);
        dist.recover(t);
    }

    function test_Recover_UnderpaymentRefundedAfterDelay() public {
        Terms memory t = _defaultTerms();
        _fund(t, 6e6);
        vm.warp(uint256(expiry) + DELAY + 1);
        dist.recover(t);
        assertEq(usdc.balanceOf(refund), 6e6);
    }

    function test_Recover_CounterfactualReceiverIsDeployed() public {
        Terms memory t = _defaultTerms();
        address r = _fund(t, AMOUNT);
        assertEq(r.code.length, 0);
        vm.warp(uint256(expiry) + DELAY + 1);
        dist.recover(t);
        assertGt(r.code.length, 0);
        assertEq(usdc.balanceOf(refund), AMOUNT);
    }

    function test_Recover_LateTopUpAfterSettlementGoesToRefundNotMerchant() public {
        Terms memory t = _defaultTerms();
        address r = _fundAndSettle(t);
        vm.warp(uint256(expiry) + 5 days);
        usdc.mint(r, 3e6);
        dist.recover(t);
        assertEq(usdc.balanceOf(refund), 3e6);
        assertEq(usdc.balanceOf(merchant), 9_880_000);
    }

    function testFuzz_Recover_OnlyEverPaysRefundAddressAndAnyoneCanCall(address caller, uint256 amount) public {
        vm.assume(caller != address(0) && caller != refund && caller != merchant);
        vm.assume(caller != address(dist) && caller != address(factory));
        amount = bound(amount, 1, 1e15);
        Terms memory t = _defaultTerms();
        address r = _fund(t, amount);
        vm.assume(caller != r);
        vm.warp(uint256(expiry) + DELAY + 1);

        uint256 callerBefore = usdc.balanceOf(caller);
        uint256 merchantBefore = usdc.balanceOf(merchant);
        vm.prank(caller);
        dist.recover(t);

        assertEq(usdc.balanceOf(refund), amount);
        assertEq(usdc.balanceOf(caller), callerBefore);
        assertEq(usdc.balanceOf(merchant), merchantBefore);
        assertEq(usdc.balanceOf(r), 0);
    }

    function test_Recover_RevertsAtomicallyIfRefundAddressBlocklisted() public {
        Terms memory t = _defaultTerms();
        address r = _fund(t, AMOUNT);
        vm.warp(uint256(expiry) + DELAY + 1);
        usdc.setBlocklisted(refund, true);
        vm.expectRevert(abi.encodeWithSignature("Blocklisted(address)", refund));
        dist.recover(t);
        assertEq(usdc.balanceOf(r), AMOUNT);
        assertEq(dist.recoveredAmount(r), 0);
    }

    function test_Recover_ValidatesTerms() public {
        Terms memory t = _defaultTerms();
        t.amount = 1;
        vm.expectRevert(PaymentDistributor.AmountBelowMinimum.selector);
        dist.recover(t);
    }
}
