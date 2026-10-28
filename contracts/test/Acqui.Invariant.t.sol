// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {AcquiTestBase} from "./Acqui.Base.t.sol";
import {Terms} from "../AcquiTerms.sol";
import {PaymentDistributor} from "../PaymentDistributor.sol";
import {MockUSDC} from "./mocks/MockUSDC.sol";

/// Drives bounded random sequences over a small pool of receivers.
contract AcquiHandler is Test {
    uint256 internal constant N = 4;

    PaymentDistributor public dist;
    MockUSDC public usdc;
    uint256 internal attesterPk;
    address internal keeper;

    Terms[N] internal terms;
    address[N] public receivers;
    uint256[N] public deposited; // total ever minted into each receiver
    uint256[N] public onTimeDeposited; // deposited while block.timestamp <= expiry
    uint256[N] public outflow; // total ever pulled out of each receiver

    uint256 public totalDonations;
    uint256 public pendingDonations; // donated since last collect
    uint256 public settleCount;
    uint256 public recoverCount;
    uint256 public collectCount;

    constructor(PaymentDistributor d, MockUSDC u, uint256 pk, address keeper_, address merchant, address refund, uint64 expiry) {
        dist = d;
        usdc = u;
        attesterPk = pk;
        keeper = keeper_;
        for (uint256 i = 0; i < N; i++) {
            terms[i] = Terms({
                intentId: keccak256(abi.encode("intent", i)),
                attemptId: keccak256(abi.encode("attempt", i)),
                merchant: merchant,
                refundAddress: refund,
                amount: (i + 1) * 3e6,
                expiry: expiry,
                feeBps: 10,
                minFee: 100_000,
                keeperReimbursement: i * 5_000
            });
            receivers[i] = d.predictReceiver(terms[i]);
        }
    }

    function deposit(uint256 idx, uint256 amount) external {
        idx = bound(idx, 0, N - 1);
        amount = bound(amount, 1, 20e6);
        usdc.mint(receivers[idx], amount);
        deposited[idx] += amount;
        if (block.timestamp <= terms[idx].expiry) onTimeDeposited[idx] += amount;
    }

    function settle(uint256 idx) external {
        idx = bound(idx, 0, N - 1);
        Terms memory t = terms[idx];
        uint64 depTs = uint64(block.timestamp <= t.expiry ? block.timestamp : t.expiry);
        PaymentDistributor.SettlementEvidence memory e = PaymentDistributor.SettlementEvidence({
            eligibleAmount: onTimeDeposited[idx],
            depositTimestamp: depTs,
            evidenceTxHash: keccak256("tx"),
            evidenceBlock: 1
        });
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(attesterPk, dist.settlementDigest(t, e));
        uint256 before = usdc.balanceOf(receivers[idx]);
        vm.prank(keeper);
        try dist.settle(t, e, abi.encodePacked(r, s, v)) {
            outflow[idx] += before - usdc.balanceOf(receivers[idx]);
            settleCount++;
        } catch {}
    }

    function recover(uint256 idx) external {
        idx = bound(idx, 0, N - 1);
        uint256 before = usdc.balanceOf(receivers[idx]);
        try dist.recover(terms[idx]) {
            outflow[idx] += before - usdc.balanceOf(receivers[idx]);
            recoverCount++;
        } catch {}
    }

    function collectFees() external {
        try dist.collectFees() {
            pendingDonations = 0;
            collectCount++;
        } catch {}
    }

    function donate(uint256 amount) external {
        amount = bound(amount, 1, 5e6);
        usdc.mint(address(dist), amount);
        totalDonations += amount;
        pendingDonations += amount;
    }

    function warp(uint256 dt) external {
        dt = bound(dt, 0, 12 hours);
        vm.warp(block.timestamp + dt);
    }

    function sumReceiverBalances() external view returns (uint256 s) {
        for (uint256 i = 0; i < N; i++) s += usdc.balanceOf(receivers[i]);
    }

    function sumDeposited() external view returns (uint256 s) {
        for (uint256 i = 0; i < N; i++) s += deposited[i];
    }

    function sumOutflow() external view returns (uint256 s) {
        for (uint256 i = 0; i < N; i++) s += outflow[i];
    }
}

contract AcquiInvariantTest is AcquiTestBase {
    AcquiHandler internal handler;

    function setUp() public override {
        super.setUp();
        handler = new AcquiHandler(dist, usdc, attesterPk, keeper, merchant, refund, expiry);
        targetContract(address(handler));
        bytes4[] memory sels = new bytes4[](6);
        sels[0] = AcquiHandler.deposit.selector;
        sels[1] = AcquiHandler.settle.selector;
        sels[2] = AcquiHandler.recover.selector;
        sels[3] = AcquiHandler.collectFees.selector;
        sels[4] = AcquiHandler.donate.selector;
        sels[5] = AcquiHandler.warp.selector;
        targetSelector(FuzzSelector({addr: address(handler), selectors: sels}));
    }

    /// Guards against vacuous invariants: the handler's settle/recover/collect paths really succeed.
    function test_HandlerReachesAllPaths() public {
        handler.deposit(1, 20e6);
        handler.settle(1);
        assertEq(handler.settleCount(), 1);
        handler.recover(1); // overpayment excess, open right after settlement
        assertEq(handler.recoverCount(), 1);
        handler.collectFees();
        assertEq(handler.collectCount(), 1);
        handler.donate(10);
        handler.deposit(2, 1e6);
        handler.warp(12 hours);
        assertGt(handler.outflow(1), 0);
    }

    /// Receiver outflows never exceed deposits, in aggregate and per receiver; value is conserved.
    function invariant_ReceiverOutflowsNeverExceedDeposits() public view {
        assertLe(handler.sumOutflow(), handler.sumDeposited());
        for (uint256 i = 0; i < 4; i++) {
            assertLe(handler.outflow(i), handler.deposited(i));
            assertEq(usdc.balanceOf(handler.receivers(i)), handler.deposited(i) - handler.outflow(i));
        }
        assertEq(handler.sumReceiverBalances(), handler.sumDeposited() - handler.sumOutflow());
    }

    /// Settlements only ever take invoice gross out of a receiver.
    function invariant_SettledGrossBoundedByInvoices() public view {
        uint256 gross;
        for (uint256 i = 0; i < 4; i++) {
            (bool settled, uint256 g,,,) = dist.settlements(handler.receivers(i));
            if (settled) gross += g;
        }
        assertEq(dist.totalGrossSettled(), gross);
    }

    /// Fees collected never exceed fees accrued plus donations.
    function invariant_CollectedNeverExceedsAccruedPlusDonations() public view {
        assertLe(dist.totalFeesCollected(), dist.totalFeesAccrued() + handler.totalDonations());
        assertLe(dist.accruedFees(), dist.totalFeesAccrued());
    }

    /// Distributor balance equals accrued fees plus pending donations.
    function invariant_DistributorBalanceIsFeesPlusDonations() public view {
        assertEq(usdc.balanceOf(address(dist)), dist.accruedFees() + handler.pendingDonations());
        assertEq(
            usdc.balanceOf(address(dist)),
            dist.totalFeesAccrued() + handler.totalDonations() - dist.totalFeesCollected()
        );
    }

    /// Merchant, keeper, refund and fee safe can only hold what receivers/donations produced.
    function invariant_SystemConservation() public view {
        uint256 held = usdc.balanceOf(merchant) + usdc.balanceOf(keeper) + usdc.balanceOf(refund)
            + usdc.balanceOf(feeSafe) + usdc.balanceOf(address(dist)) + handler.sumReceiverBalances();
        assertEq(held, handler.sumDeposited() + handler.totalDonations());
    }
}
