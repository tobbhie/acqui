// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {AcquiTestBase} from "./Acqui.Base.t.sol";
import {Terms} from "../AcquiTerms.sol";
import {PaymentDistributor} from "../PaymentDistributor.sol";

/// Attestation, replay and compromised-keeper constraints.
contract AcquiSecurityTest is AcquiTestBase {
    uint256 internal constant OTHER_PK = 0xBADC0FFEE;

    // ---------- duplicate settlement / replay ----------

    function test_Revert_DuplicateSettlementSameSignature() public {
        Terms memory t = _defaultTerms();
        _fund(t, 30e6);
        PaymentDistributor.SettlementEvidence memory e = _onTimeEv(t);
        bytes memory sig = _sign(attesterPk, t, e);
        dist.settle(t, e, sig);

        vm.expectRevert(PaymentDistributor.AlreadySettled.selector);
        dist.settle(t, e, sig);

        // a second attestation with different evidence for the same terms is also rejected
        e.evidenceBlock = 999;
        bytes memory sig2 = _sign(attesterPk, t, e);
        vm.expectRevert(PaymentDistributor.AlreadySettled.selector);
        dist.settle(t, e, sig2);

        assertEq(dist.totalGrossSettled(), AMOUNT);
        assertEq(usdc.balanceOf(merchant), 9_880_000);
    }

    function test_Revert_SignatureReplayForDifferentReceiver() public {
        Terms memory t1 = _defaultTerms();
        Terms memory t2 = _terms(keccak256("attempt-2"), AMOUNT);
        _fund(t1, AMOUNT);
        _fund(t2, AMOUNT);
        PaymentDistributor.SettlementEvidence memory e = _onTimeEv(t1);
        bytes memory sig = _sign(attesterPk, t1, e);
        dist.settle(t1, e, sig);

        vm.expectRevert(PaymentDistributor.InvalidAttestation.selector);
        dist.settle(t2, e, sig);
        assertEq(usdc.balanceOf(dist.predictReceiver(t2)), AMOUNT, "second receiver untouched");
    }

    function test_Revert_SignatureReplayOnDifferentChain() public {
        Terms memory t = _defaultTerms();
        _fund(t, AMOUNT);
        PaymentDistributor.SettlementEvidence memory e = _onTimeEv(t);
        bytes memory sig = _sign(attesterPk, t, e);

        vm.chainId(999);
        _fund(t, AMOUNT); // receiver address on the new chain differs, fund it too
        vm.expectRevert(PaymentDistributor.InvalidAttestation.selector);
        dist.settle(t, e, sig);
    }

    function test_Revert_SignatureReplayOnDifferentDistributor() public {
        PaymentDistributor d2 = new PaymentDistributor(usdc, attester, feeSafe, MAX_REIMB, DELAY);
        Terms memory t = _defaultTerms();
        usdc.mint(d2.predictReceiver(t), AMOUNT);
        PaymentDistributor.SettlementEvidence memory e = _onTimeEv(t);
        bytes memory sig = _sign(attesterPk, t, e); // domain of `dist`
        vm.expectRevert(PaymentDistributor.InvalidAttestation.selector);
        d2.settle(t, e, sig);

        // sanity: a signature for the right domain works there
        bytes memory sig2 = _signWith(d2, attesterPk, t, e);
        d2.settle(t, e, sig2);
        assertEq(usdc.balanceOf(merchant), 9_880_000);
    }

    // ---------- compromised keeper ----------

    function test_Revert_KeeperAloneCannotSettle() public {
        Terms memory t = _defaultTerms();
        _fund(t, AMOUNT);
        PaymentDistributor.SettlementEvidence memory e = _onTimeEv(t);

        vm.prank(keeper);
        vm.expectRevert(PaymentDistributor.InvalidAttestation.selector);
        dist.settle(t, e, "");

        vm.prank(keeper);
        vm.expectRevert(PaymentDistributor.InvalidAttestation.selector);
        dist.settle(t, e, new bytes(65));

        vm.prank(keeper);
        vm.expectRevert(PaymentDistributor.InvalidAttestation.selector);
        dist.settle(t, e, hex"deadbeef");
    }

    function test_Revert_WrongSignerRejected() public {
        Terms memory t = _defaultTerms();
        _fund(t, AMOUNT);
        PaymentDistributor.SettlementEvidence memory e = _onTimeEv(t);
        bytes memory sig = _sign(OTHER_PK, t, e);
        vm.prank(keeper);
        vm.expectRevert(PaymentDistributor.InvalidAttestation.selector);
        dist.settle(t, e, sig);
    }

    function test_Revert_TamperedEvidenceRejected() public {
        Terms memory t = _defaultTerms();
        _fund(t, 20e6);
        PaymentDistributor.SettlementEvidence memory e = _onTimeEv(t);
        bytes memory sig = _sign(attesterPk, t, e);

        PaymentDistributor.SettlementEvidence memory x = _onTimeEv(t);
        x.eligibleAmount = e.eligibleAmount + 1;
        vm.expectRevert(PaymentDistributor.InvalidAttestation.selector);
        dist.settle(t, x, sig);

        x = _onTimeEv(t);
        x.depositTimestamp = e.depositTimestamp - 1;
        vm.expectRevert(PaymentDistributor.InvalidAttestation.selector);
        dist.settle(t, x, sig);

        x = _onTimeEv(t);
        x.evidenceTxHash = keccak256("other");
        vm.expectRevert(PaymentDistributor.InvalidAttestation.selector);
        dist.settle(t, x, sig);

        x = _onTimeEv(t);
        x.evidenceBlock = e.evidenceBlock + 1;
        vm.expectRevert(PaymentDistributor.InvalidAttestation.selector);
        dist.settle(t, x, sig);
    }

    function test_Revert_KeeperCannotChangeMerchant() public {
        Terms memory t = _defaultTerms();
        PaymentDistributor.SettlementEvidence memory e = _onTimeEv(t);
        bytes memory sig = _sign(attesterPk, t, e);
        t.merchant = keeper;
        _fund(t, AMOUNT);
        vm.prank(keeper);
        vm.expectRevert(PaymentDistributor.InvalidAttestation.selector);
        dist.settle(t, e, sig);
    }

    function test_Revert_KeeperCannotChangeRefundAddress() public {
        Terms memory t = _defaultTerms();
        PaymentDistributor.SettlementEvidence memory e = _onTimeEv(t);
        bytes memory sig = _sign(attesterPk, t, e);
        t.refundAddress = keeper;
        _fund(t, AMOUNT);
        vm.prank(keeper);
        vm.expectRevert(PaymentDistributor.InvalidAttestation.selector);
        dist.settle(t, e, sig);
    }

    function test_Revert_KeeperCannotChangeAmount() public {
        Terms memory t = _defaultTerms();
        PaymentDistributor.SettlementEvidence memory e = _onTimeEv(t);
        bytes memory sig = _sign(attesterPk, t, e);
        t.amount = AMOUNT - 1_000_000;
        _fund(t, t.amount);
        vm.prank(keeper);
        vm.expectRevert(PaymentDistributor.InvalidAttestation.selector);
        dist.settle(t, e, sig);
    }

    function test_Revert_KeeperCannotChangeReimbursement() public {
        Terms memory t = _defaultTerms();
        t.keeperReimbursement = 0;
        PaymentDistributor.SettlementEvidence memory e = _onTimeEv(t);
        bytes memory sig = _sign(attesterPk, t, e);
        t.keeperReimbursement = MAX_REIMB; // greedy keeper bumps it to the max
        _fund(t, AMOUNT);
        vm.prank(keeper);
        vm.expectRevert(PaymentDistributor.InvalidAttestation.selector);
        dist.settle(t, e, sig);
    }

    function test_KeeperGetsExactlyPrecommittedReimbursement() public {
        Terms memory t = _defaultTerms();
        t.keeperReimbursement = 7_777;
        _fundAndSettle(t);
        assertEq(usdc.balanceOf(keeper), 7_777);
        assertEq(usdc.balanceOf(merchant), AMOUNT - 100_000 - 7_777);
    }

    function test_SettleCannotPayMoreThanInvoiceFromLargeReceiverBalance() public {
        Terms memory t = _defaultTerms();
        address r = _fund(t, 1_000e6);
        _settleSigned(t);
        // exactly gross left the receiver, not the full balance
        assertEq(usdc.balanceOf(r), 1_000e6 - AMOUNT);
        assertEq(usdc.balanceOf(merchant) + usdc.balanceOf(keeper) + usdc.balanceOf(address(dist)), AMOUNT);
    }

    function test_Revert_InsufficientReceiverBalanceDespiteValidAttestation() public {
        Terms memory t = _defaultTerms();
        _fund(t, AMOUNT - 1);
        PaymentDistributor.SettlementEvidence memory e = _onTimeEv(t);
        bytes memory sig = _sign(attesterPk, t, e);
        vm.prank(keeper);
        vm.expectRevert(PaymentDistributor.InsufficientReceiverBalance.selector);
        dist.settle(t, e, sig);
        assertEq(usdc.balanceOf(keeper), 0);
    }

    function test_Revert_AttestationForOtherAttemptCannotDrainThisReceiver() public {
        // attacker uses a valid attestation for a cheap invoice to pull from a rich receiver
        Terms memory cheap = _terms(keccak256("cheap"), 1e6);
        Terms memory rich = _terms(keccak256("rich"), 500e6);
        _fund(rich, 500e6);
        PaymentDistributor.SettlementEvidence memory e = _onTimeEv(cheap);
        bytes memory sig = _sign(attesterPk, cheap, e);
        PaymentDistributor.SettlementEvidence memory er = _onTimeEv(rich);
        vm.prank(keeper);
        vm.expectRevert(PaymentDistributor.InvalidAttestation.selector);
        dist.settle(rich, er, sig);
    }
}
