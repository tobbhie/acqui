// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {AcquiTestBase} from "./Acqui.Base.t.sol";
import {Terms} from "../AcquiTerms.sol";
import {PaymentDistributor} from "../PaymentDistributor.sol";

/// Fee math and collectFees.
contract AcquiFeesTest is AcquiTestBase {
    // ---------- computeFee ----------

    function test_ComputeFee_MinimumFloor() public view {
        assertEq(dist.computeFee(1e6), 100_000);
        assertEq(dist.computeFee(10e6), 100_000);
        assertEq(dist.computeFee(100e6), 100_000); // 0.1% == 0.10 exactly
    }

    function test_ComputeFee_ProportionalAboveFloor() public view {
        assertEq(dist.computeFee(1_000e6), 1_000_000);
        assertEq(dist.computeFee(250_000e6), 250_000_000);
    }

    function test_ComputeFee_RoundsUp() public view {
        assertEq(dist.computeFee(100e6 + 1), 100_001); // 100_000.1 -> 100_001
        assertEq(dist.computeFee(150_000_005), 150_001); // 150_000.005 -> 150_001
        assertEq(dist.computeFee(150_000_000), 150_000); // exact stays exact
    }

    function test_PreviewSettlement_Example() public view {
        (uint256 fee, uint256 net) = dist.previewSettlement(10e6, 20_000);
        assertEq(fee, 100_000);
        assertEq(net, 9_880_000);
    }

    function test_PreviewSettlement_Reverts() public {
        vm.expectRevert(PaymentDistributor.AmountBelowMinimum.selector);
        dist.previewSettlement(999_999, 0);
        vm.expectRevert(PaymentDistributor.KeeperReimbursementTooHigh.selector);
        dist.previewSettlement(10e6, MAX_REIMB + 1);
    }

    function testFuzz_FeeReimbursementNetSumToGross(uint256 amount, uint256 reimb) public view {
        amount = bound(amount, 1e6, 1e18);
        reimb = bound(reimb, 0, MAX_REIMB);
        (uint256 fee, uint256 net) = dist.previewSettlement(amount, reimb);
        assertEq(fee + reimb + net, amount, "conservation");
        assertGt(net, 0, "net positive");
        assertGe(fee, 100_000);
        assertEq(fee, dist.computeFee(amount));
        // fee is never below the exact proportional amount (ceil) and < 1 base unit above it
        assertGe(fee * 10_000, amount * 10);
        if (fee > 100_000) assertLt((fee - 1) * 10_000, amount * 10);
    }

    function testFuzz_SettleDistributesExactly(uint256 amount, uint256 reimb, uint256 extra) public {
        amount = bound(amount, 1e6, 1e15);
        reimb = bound(reimb, 0, MAX_REIMB);
        extra = bound(extra, 0, 1e15);
        Terms memory t = _terms(keccak256("fuzz"), amount);
        t.keeperReimbursement = reimb;
        address r = _fund(t, amount + extra);
        _settleSigned(t);
        (uint256 fee, uint256 net) = dist.previewSettlement(amount, reimb);
        assertEq(usdc.balanceOf(merchant), net);
        assertEq(usdc.balanceOf(keeper), reimb);
        assertEq(usdc.balanceOf(address(dist)), fee);
        assertEq(usdc.balanceOf(r), extra);
    }

    // ---------- collectFees ----------

    function test_CollectFees_SendsFullBalanceToFeeSafe() public {
        _fundAndSettle(_defaultTerms());
        _fundAndSettle(_terms(keccak256("second"), 1_000e6));
        uint256 expected = 100_000 + 1_000_000;
        assertEq(dist.accruedFees(), expected);

        vm.expectEmit(true, false, false, true, address(dist));
        emit PaymentDistributor.FeesCollected(feeSafe, expected, expected);
        vm.prank(anyone);
        uint256 got = dist.collectFees();

        assertEq(got, expected);
        assertEq(usdc.balanceOf(feeSafe), expected);
        assertEq(usdc.balanceOf(address(dist)), 0);
        assertEq(usdc.balanceOf(anyone), 0, "caller gets nothing");
        assertEq(dist.accruedFees(), 0);
        assertEq(dist.totalFeesAccrued(), expected);
        assertEq(dist.totalFeesCollected(), expected);
    }

    function test_CollectFees_RevertsWhenZero() public {
        vm.expectRevert(PaymentDistributor.NothingToCollect.selector);
        dist.collectFees();

        _fundAndSettle(_defaultTerms());
        dist.collectFees();
        vm.expectRevert(PaymentDistributor.NothingToCollect.selector);
        dist.collectFees();
    }

    function test_CollectFees_AccidentalTransfersGoToSafe() public {
        usdc.mint(address(dist), 5e6); // accidental / donation
        assertEq(dist.accruedFees(), 0);
        vm.prank(keeper);
        uint256 got = dist.collectFees();
        assertEq(got, 5e6);
        assertEq(usdc.balanceOf(feeSafe), 5e6);
        assertEq(usdc.balanceOf(keeper), 0);
        assertEq(dist.totalFeesCollected(), 5e6);
        assertEq(dist.totalFeesAccrued(), 0);
    }

    function test_CollectFees_MixedFeesAndDonation() public {
        _fundAndSettle(_defaultTerms());
        usdc.mint(address(dist), 777);
        vm.expectEmit(true, false, false, true, address(dist));
        emit PaymentDistributor.FeesCollected(feeSafe, 100_777, 100_000);
        dist.collectFees();
        assertEq(usdc.balanceOf(feeSafe), 100_777);
        assertEq(dist.accruedFees(), 0);
        assertEq(dist.totalFeesCollected(), 100_777);
        assertEq(dist.totalFeesAccrued(), 100_000);
    }

    function test_CollectFees_AccruesAcrossCollections() public {
        _fundAndSettle(_defaultTerms());
        dist.collectFees();
        _fundAndSettle(_terms(keccak256("again"), 10e6));
        assertEq(dist.accruedFees(), 100_000);
        dist.collectFees();
        assertEq(usdc.balanceOf(feeSafe), 200_000);
        assertEq(dist.totalFeesAccrued(), 200_000);
        assertEq(dist.totalFeesCollected(), 200_000);
    }

    function testFuzz_CollectFees_AlwaysToFeeSafe(address caller) public {
        vm.assume(caller != address(0) && caller != feeSafe && caller != address(dist));
        usdc.mint(address(dist), 1234);
        vm.prank(caller);
        dist.collectFees();
        assertEq(usdc.balanceOf(feeSafe), 1234);
        assertEq(usdc.balanceOf(caller), 0);
    }
}
