// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {AcquiTestBase} from "./Acqui.Base.t.sol";
import {Terms} from "../AcquiTerms.sol";
import {PaymentDistributor} from "../PaymentDistributor.sol";

/// Malicious-USDC-hook reentrancy and blocklist atomicity.
contract AcquiReentrancyTest is AcquiTestBase {
    bytes internal guardErr = abi.encodeWithSelector(ReentrancyGuard.ReentrancyGuardReentrantCall.selector);

    function _assertHookBlocked() internal view {
        assertTrue(usdc.hookCalled(), "hook did not fire");
        assertFalse(usdc.hookSuccess(), "reentrant call must fail");
        assertEq(usdc.hookReturn(), guardErr, "must fail on the reentrancy guard");
    }

    // ---------- settle ----------

    function test_Reentrancy_SettleCannotReenterCollectFees() public {
        Terms memory t = _defaultTerms();
        _fund(t, AMOUNT);
        usdc.armHook(address(dist), abi.encodeCall(PaymentDistributor.collectFees, ()), merchant);
        _settleSigned(t);
        _assertHookBlocked();
        assertEq(usdc.balanceOf(merchant), 9_880_000);
        assertEq(usdc.balanceOf(address(dist)), 100_000);
    }

    function test_Reentrancy_SettleCannotReenterRecover() public {
        Terms memory t = _defaultTerms();
        _fund(t, 15e6);
        usdc.armHook(address(dist), abi.encodeCall(PaymentDistributor.recover, (t)), merchant);
        _settleSigned(t);
        _assertHookBlocked();
        assertEq(usdc.balanceOf(refund), 0, "no refund via reentrancy");
    }

    function test_Reentrancy_SettleCannotReenterSettle() public {
        Terms memory t = _defaultTerms();
        _fund(t, 30e6);
        PaymentDistributor.SettlementEvidence memory e = _onTimeEv(t);
        bytes memory sig = _sign(attesterPk, t, e);
        usdc.armHook(address(dist), abi.encodeCall(PaymentDistributor.settle, (t, e, sig)), address(0));
        vm.prank(keeper);
        dist.settle(t, e, sig);
        _assertHookBlocked();
        assertEq(usdc.balanceOf(merchant), 9_880_000, "paid exactly once");
        assertEq(dist.totalGrossSettled(), AMOUNT);
    }

    function test_Reentrancy_SettleHookOnKeeperAndFeeTransfers() public {
        Terms memory t = _defaultTerms();
        _fund(t, AMOUNT);
        usdc.armHook(address(dist), abi.encodeCall(PaymentDistributor.collectFees, ()), keeper);
        _settleSigned(t);
        _assertHookBlocked();

        Terms memory t2 = _terms(keccak256("two"), AMOUNT);
        _fund(t2, AMOUNT);
        usdc.armHook(address(dist), abi.encodeCall(PaymentDistributor.collectFees, ()), address(dist));
        _settleSigned(t2);
        _assertHookBlocked();
        assertEq(usdc.balanceOf(address(dist)), 200_000);
    }

    // ---------- recover ----------

    function test_Reentrancy_RecoverCannotReenter() public {
        Terms memory t = _defaultTerms();
        _fund(t, AMOUNT);
        vm.warp(uint256(expiry) + DELAY + 1);

        usdc.armHook(address(dist), abi.encodeCall(PaymentDistributor.recover, (t)), refund);
        dist.recover(t);
        _assertHookBlocked();
        assertEq(usdc.balanceOf(refund), AMOUNT);

        usdc.mint(dist.predictReceiver(t), 1e6);
        usdc.armHook(address(dist), abi.encodeCall(PaymentDistributor.collectFees, ()), refund);
        dist.recover(t);
        _assertHookBlocked();
        assertEq(usdc.balanceOf(refund), AMOUNT + 1e6);
    }

    // ---------- collectFees ----------

    function test_Reentrancy_CollectFeesCannotReenter() public {
        Terms memory t = _defaultTerms();
        _fundAndSettle(t);
        usdc.armHook(address(dist), abi.encodeCall(PaymentDistributor.collectFees, ()), feeSafe);
        dist.collectFees();
        _assertHookBlocked();
        assertEq(usdc.balanceOf(feeSafe), 100_000);
        assertEq(dist.totalFeesCollected(), 100_000);

        // and cannot re-enter recover
        Terms memory t2 = _terms(keccak256("two"), AMOUNT);
        _fund(t2, 15e6);
        _settleSigned(t2);
        usdc.armHook(address(dist), abi.encodeCall(PaymentDistributor.recover, (t2)), feeSafe);
        dist.collectFees();
        _assertHookBlocked();
        assertEq(usdc.balanceOf(refund), 0);
    }

    // ---------- blocklist atomicity ----------

    function test_Blocklist_MerchantMakesSettleRevertAtomically() public {
        Terms memory t = _defaultTerms();
        address r = _receiver(t);
        usdc.mint(r, AMOUNT); // counterfactual: receiver not deployed yet
        usdc.setBlocklisted(merchant, true);
        PaymentDistributor.SettlementEvidence memory e = _onTimeEv(t);
        bytes memory sig = _sign(attesterPk, t, e);

        vm.prank(keeper);
        vm.expectRevert(abi.encodeWithSignature("Blocklisted(address)", merchant));
        dist.settle(t, e, sig);

        (bool settled,,,,) = dist.settlements(r);
        assertFalse(settled);
        assertEq(dist.accruedFees(), 0);
        assertEq(dist.totalFeesAccrued(), 0);
        assertEq(dist.totalGrossSettled(), 0);
        assertEq(usdc.balanceOf(r), AMOUNT);
        assertEq(usdc.balanceOf(keeper), 0);
        assertEq(usdc.balanceOf(address(dist)), 0);
        assertEq(r.code.length, 0, "receiver deployment rolled back");
        assertFalse(factory.isRegistered(r));

        // unblocking lets the same attestation settle
        usdc.setBlocklisted(merchant, false);
        vm.prank(keeper);
        dist.settle(t, e, sig);
        assertEq(usdc.balanceOf(merchant), 9_880_000);
    }

    function test_Blocklist_KeeperMakesSettleRevertAtomically() public {
        Terms memory t = _defaultTerms();
        address r = _fund(t, AMOUNT);
        usdc.setBlocklisted(keeper, true);
        PaymentDistributor.SettlementEvidence memory e = _onTimeEv(t);
        bytes memory sig = _sign(attesterPk, t, e);
        vm.prank(keeper);
        vm.expectRevert(abi.encodeWithSignature("Blocklisted(address)", keeper));
        dist.settle(t, e, sig);
        assertEq(usdc.balanceOf(merchant), 0, "merchant leg rolled back");
        assertEq(usdc.balanceOf(r), AMOUNT);
        (bool settled,,,,) = dist.settlements(r);
        assertFalse(settled);
    }

    function test_Blocklist_FeeSafeMakesCollectFeesRevertWithoutStateChange() public {
        _fundAndSettle(_defaultTerms());
        usdc.setBlocklisted(feeSafe, true);
        vm.expectRevert(abi.encodeWithSignature("Blocklisted(address)", feeSafe));
        dist.collectFees();
        assertEq(dist.accruedFees(), 100_000);
        assertEq(dist.totalFeesCollected(), 0);
        assertEq(usdc.balanceOf(address(dist)), 100_000);
    }
}
