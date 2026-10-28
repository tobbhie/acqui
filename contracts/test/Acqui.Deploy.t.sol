// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Vm} from "forge-std/Vm.sol";
import {AcquiTestBase} from "./Acqui.Base.t.sol";
import {Terms} from "../AcquiTerms.sol";
import {PaymentDistributor} from "../PaymentDistributor.sol";
import {PaymentFactory} from "../PaymentFactory.sol";
import {PaymentReceiver} from "../PaymentReceiver.sol";
import {MockUSDC, MockUSDC18, NoDecimalsToken} from "./mocks/MockUSDC.sol";

/// Constructor, immutables, CREATE2 addressing, factory and receiver behaviour.
contract AcquiDeployTest is AcquiTestBase {
    // ---------- immutables ----------

    function test_Immutables() public view {
        assertEq(address(dist.USDC()), address(usdc));
        assertEq(dist.ATTESTER(), attester);
        assertEq(dist.FEE_SAFE(), feeSafe);
        assertEq(dist.DEPLOYED_CHAIN_ID(), block.chainid);
        assertEq(dist.MAX_KEEPER_REIMBURSEMENT(), MAX_REIMB);
        assertEq(dist.RECOVERY_DELAY(), DELAY);
        assertEq(address(dist.FACTORY()), address(factory));
        assertEq(factory.distributor(), address(dist));
        assertEq(factory.DEPLOYED_CHAIN_ID(), block.chainid);
        assertEq(dist.MIN_PAYMENT(), 1_000_000);
        assertEq(dist.MIN_FEE(), 100_000);
        assertEq(dist.FEE_BPS(), 10);
        assertEq(dist.BPS_DENOMINATOR(), 10_000);
    }

    function test_Constructor_EmitsDistributorDeployed() public {
        // factory address is unknown ahead of time: check data only (non-indexed fields)
        vm.expectEmit(false, false, false, true);
        emit PaymentDistributor.DistributorDeployed(
            address(0), block.chainid, address(usdc), attester, feeSafe, MAX_REIMB, DELAY
        );
        new PaymentDistributor(usdc, attester, feeSafe, MAX_REIMB, DELAY);
    }

    function test_Receiver_ImmutablesAndNativeReceive() public {
        Terms memory t = _defaultTerms();
        address r = factory.deployReceiver(_hash(t));
        assertEq(PaymentReceiver(payable(r)).distributor(), address(dist));
        assertEq(PaymentReceiver(payable(r)).termsHash(), _hash(t));
        vm.deal(address(this), 1 ether);
        (bool ok,) = r.call{value: 1 ether}("");
        assertTrue(ok, "receiver accepts native sends");
    }

    function test_Receiver_PullOnlyByDistributor() public {
        Terms memory t = _defaultTerms();
        address r = _fund(t, AMOUNT);
        factory.deployReceiver(_hash(t));
        vm.prank(anyone);
        vm.expectRevert(PaymentReceiver.UnauthorizedDistributor.selector);
        PaymentReceiver(payable(r)).pull(IERC20(address(usdc)), anyone, 1);
        vm.prank(address(factory));
        vm.expectRevert(PaymentReceiver.UnauthorizedDistributor.selector);
        PaymentReceiver(payable(r)).pull(IERC20(address(usdc)), anyone, 1);
    }

    function test_Distributor_RejectsNativeSends() public {
        vm.deal(address(this), 1 ether);
        (bool ok,) = address(dist).call{value: 1 ether}("");
        assertFalse(ok);
    }

    // ---------- constructor bounds ----------

    function test_Constructor_RevertsOnZeroAddresses() public {
        vm.expectRevert(PaymentDistributor.ZeroAddress.selector);
        new PaymentDistributor(IERC20(address(0)), attester, feeSafe, MAX_REIMB, DELAY);
        vm.expectRevert(PaymentDistributor.ZeroAddress.selector);
        new PaymentDistributor(usdc, address(0), feeSafe, MAX_REIMB, DELAY);
        vm.expectRevert(PaymentDistributor.ZeroAddress.selector);
        new PaymentDistributor(usdc, attester, address(0), MAX_REIMB, DELAY);
    }

    function test_Constructor_RevertsWhenAttesterIsFeeSafe() public {
        vm.expectRevert(PaymentDistributor.AttesterEqualsFeeSafe.selector);
        new PaymentDistributor(usdc, attester, attester, MAX_REIMB, DELAY);
    }

    function test_Constructor_RevertsOnTokenWithoutCode() public {
        vm.expectRevert(PaymentDistributor.TokenWithoutCode.selector);
        new PaymentDistributor(IERC20(makeAddr("eoa")), attester, feeSafe, MAX_REIMB, DELAY);
    }

    function test_Constructor_RevertsOnWrongDecimals() public {
        IERC20 bad = IERC20(address(new MockUSDC18()));
        vm.expectRevert(PaymentDistributor.InvalidTokenDecimals.selector);
        new PaymentDistributor(bad, attester, feeSafe, MAX_REIMB, DELAY);
    }

    function test_Constructor_RevertsWhenDecimalsMissing() public {
        IERC20 bad = IERC20(address(new NoDecimalsToken()));
        vm.expectRevert(PaymentDistributor.InvalidTokenDecimals.selector);
        new PaymentDistributor(bad, attester, feeSafe, MAX_REIMB, DELAY);
    }

    function test_Constructor_ReimbursementBound() public {
        new PaymentDistributor(usdc, attester, feeSafe, 100_000, DELAY); // == MIN_FEE ok
        new PaymentDistributor(usdc, attester, feeSafe, 0, DELAY); // zero ok
        vm.expectRevert(PaymentDistributor.KeeperReimbursementTooHigh.selector);
        new PaymentDistributor(usdc, attester, feeSafe, 100_001, DELAY);
    }

    function test_Constructor_RecoveryDelayBounds() public {
        new PaymentDistributor(usdc, attester, feeSafe, MAX_REIMB, 1 hours);
        new PaymentDistributor(usdc, attester, feeSafe, MAX_REIMB, 30 days);
        vm.expectRevert(PaymentDistributor.InvalidRecoveryDelay.selector);
        new PaymentDistributor(usdc, attester, feeSafe, MAX_REIMB, 1 hours - 1);
        vm.expectRevert(PaymentDistributor.InvalidRecoveryDelay.selector);
        new PaymentDistributor(usdc, attester, feeSafe, MAX_REIMB, 30 days + 1);
        vm.expectRevert(PaymentDistributor.InvalidRecoveryDelay.selector);
        new PaymentDistributor(usdc, attester, feeSafe, MAX_REIMB, 0);
    }

    // ---------- CREATE2 addressing ----------

    function test_PredictReceiverMatchesDeployed() public {
        Terms memory t = _defaultTerms();
        address predicted = dist.predictReceiver(t);
        assertEq(predicted, factory.predictReceiver(_hash(t)));
        assertEq(predicted.code.length, 0);

        vm.expectEmit(true, true, false, false, address(factory));
        emit PaymentFactory.ReceiverDeployed(_hash(t), predicted);
        address deployed = factory.deployReceiver(_hash(t));

        assertEq(deployed, predicted);
        assertGt(deployed.code.length, 0);
        assertEq(factory.termsHashOf(deployed), _hash(t));
        assertTrue(factory.isRegistered(deployed));
    }

    function test_DeployReceiver_IdempotentAndPermissionless() public {
        Terms memory t = _defaultTerms();
        vm.prank(anyone);
        address a = factory.deployReceiver(_hash(t));
        vm.recordLogs();
        vm.prank(keeper);
        address b = factory.deployReceiver(_hash(t));
        assertEq(a, b);
        assertEq(vm.getRecordedLogs().length, 0, "no second ReceiverDeployed");
    }

    function test_Factory_UnregisteredAddress() public {
        assertFalse(factory.isRegistered(makeAddr("nobody")));
    }

    function test_UniqueAddresses_PerEveryTermField() public {
        Terms memory base = _defaultTerms();
        address[10] memory addrs;
        addrs[0] = dist.predictReceiver(base);

        Terms memory t = _defaultTerms();
        t.attemptId = keccak256("attempt-2");
        addrs[1] = dist.predictReceiver(t);

        t = _defaultTerms();
        t.amount = AMOUNT + 1;
        addrs[2] = dist.predictReceiver(t);

        t = _defaultTerms();
        t.merchant = makeAddr("merchant2");
        addrs[3] = dist.predictReceiver(t);

        t = _defaultTerms();
        t.refundAddress = makeAddr("refund2");
        addrs[4] = dist.predictReceiver(t);

        t = _defaultTerms();
        t.expiry = expiry + 1;
        addrs[5] = dist.predictReceiver(t);

        t = _defaultTerms();
        t.intentId = keccak256("intent-2");
        addrs[6] = dist.predictReceiver(t);

        t = _defaultTerms();
        t.keeperReimbursement = MAX_REIMB - 1;
        addrs[7] = dist.predictReceiver(t);

        vm.chainId(4242);
        addrs[8] = dist.predictReceiver(base);

        // different distributor => different factory => different address
        vm.chainId(31337);
        PaymentDistributor d2 = new PaymentDistributor(usdc, attester, feeSafe, MAX_REIMB, DELAY);
        addrs[9] = d2.predictReceiver(base);

        for (uint256 i = 0; i < 10; i++) {
            for (uint256 j = i + 1; j < 10; j++) {
                assertNotEq(addrs[i], addrs[j]);
            }
        }
    }

    function testFuzz_UniqueAddresses(bytes32 a1, bytes32 a2, uint256 am1, uint256 am2, address m1, address m2)
        public
        view
    {
        am1 = bound(am1, 1e6, 1e15);
        am2 = bound(am2, 1e6, 1e15);
        vm.assume(a1 != a2 || am1 != am2 || m1 != m2);
        Terms memory t1 = _terms(a1, am1);
        Terms memory t2 = _terms(a2, am2);
        t1.merchant = m1;
        t2.merchant = m2;
        assertNotEq(dist.predictReceiver(t1), dist.predictReceiver(t2));
    }
}
