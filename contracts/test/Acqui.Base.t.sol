// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {Vm} from "forge-std/Vm.sol";
import {Terms, AcquiTerms} from "../AcquiTerms.sol";
import {PaymentDistributor} from "../PaymentDistributor.sol";
import {PaymentFactory} from "../PaymentFactory.sol";
import {PaymentReceiver} from "../PaymentReceiver.sol";
import {MockUSDC} from "./mocks/MockUSDC.sol";

abstract contract AcquiTestBase is Test {
    MockUSDC internal usdc;
    PaymentDistributor internal dist;
    PaymentFactory internal factory;

    address internal attester;
    uint256 internal attesterPk;
    address internal feeSafe = makeAddr("feeSafe");
    address internal merchant = makeAddr("merchant");
    address internal refund = makeAddr("refund");
    address internal keeper = makeAddr("keeper");
    address internal anyone = makeAddr("anyone");

    uint256 internal constant MAX_REIMB = 20_000; // 0.02 USDC
    uint64 internal constant DELAY = 1 days;
    uint256 internal constant AMOUNT = 10e6;
    uint256 internal constant T0 = 1_700_000_000;

    uint64 internal expiry;

    struct Settled {
        bytes32 attemptId;
        uint256 gross;
        uint256 fee;
        uint256 keeperReimbursement;
        uint256 merchantNet;
        address keeper;
        uint64 depositTimestamp;
        bytes32 evidenceTxHash;
        uint64 evidenceBlock;
    }

    function setUp() public virtual {
        vm.warp(T0);
        expiry = uint64(T0 + 30 minutes);
        (attester, attesterPk) = makeAddrAndKey("attester");
        usdc = new MockUSDC();
        dist = new PaymentDistributor(usdc, attester, feeSafe, MAX_REIMB, DELAY);
        factory = dist.FACTORY();
    }

    // ---------- helpers ----------

    function _terms(bytes32 attemptId, uint256 amount) internal view returns (Terms memory) {
        return Terms({
            intentId: keccak256("intent"),
            attemptId: attemptId,
            merchant: merchant,
            refundAddress: refund,
            amount: amount,
            expiry: expiry,
            feeBps: 10,
            minFee: 100_000,
            keeperReimbursement: MAX_REIMB
        });
    }

    function _defaultTerms() internal view returns (Terms memory) {
        return _terms(keccak256("attempt-1"), AMOUNT);
    }

    function _ev(Terms memory t, uint64 depTs) internal pure returns (PaymentDistributor.SettlementEvidence memory) {
        return PaymentDistributor.SettlementEvidence({
            eligibleAmount: t.amount,
            depositTimestamp: depTs,
            evidenceTxHash: keccak256("evidence-tx"),
            evidenceBlock: 123
        });
    }

    function _onTimeEv(Terms memory t) internal view returns (PaymentDistributor.SettlementEvidence memory) {
        return _ev(t, uint64(T0)); // deposit at setUp time, well before expiry
    }

    function _sign(uint256 pk, Terms memory t, PaymentDistributor.SettlementEvidence memory e)
        internal
        view
        returns (bytes memory)
    {
        return _signWith(dist, pk, t, e);
    }

    function _signWith(
        PaymentDistributor d,
        uint256 pk,
        Terms memory t,
        PaymentDistributor.SettlementEvidence memory e
    ) internal view returns (bytes memory) {
        bytes32 digest = d.settlementDigest(t, e);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        return abi.encodePacked(r, s, v);
    }

    function _receiver(Terms memory t) internal view returns (address) {
        return dist.predictReceiver(t);
    }

    function _fund(Terms memory t, uint256 amt) internal returns (address r) {
        r = dist.predictReceiver(t);
        usdc.mint(r, amt);
    }

    /// Fund exactly t.amount, sign on-time evidence with the attester, settle as `keeper`.
    function _fundAndSettle(Terms memory t) internal returns (address r) {
        r = _fund(t, t.amount);
        _settleSigned(t);
    }

    function _settleSigned(Terms memory t) internal {
        PaymentDistributor.SettlementEvidence memory e = _onTimeEv(t);
        bytes memory sig = _sign(attesterPk, t, e);
        vm.prank(keeper);
        dist.settle(t, e, sig);
    }

    function _findSettled(Vm.Log[] memory logs)
        internal
        view
        returns (bool found, Vm.Log memory log, Settled memory s)
    {
        bytes32 sel = PaymentDistributor.PaymentSettled.selector;
        for (uint256 i = 0; i < logs.length; i++) {
            if (logs[i].emitter == address(dist) && logs[i].topics[0] == sel) {
                s = abi.decode(logs[i].data, (Settled));
                return (true, logs[i], s);
            }
        }
    }

    function _hash(Terms memory t) internal view returns (bytes32) {
        return AcquiTerms.hash(t);
    }
}
