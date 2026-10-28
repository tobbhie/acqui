// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {PaymentFactory} from "../PaymentFactory.sol";
import {PaymentReceiver} from "../PaymentReceiver.sol";

/// Direct deployments must not accept an unusable distributor.
contract AcquiZeroDistributorTest is Test {
    function test_Factory_RejectsZeroDistributor() public {
        vm.expectRevert(PaymentFactory.ZeroAddress.selector);
        new PaymentFactory(address(0));
    }

    function test_Receiver_RejectsZeroDistributor() public {
        vm.expectRevert(PaymentReceiver.ZeroDistributor.selector);
        new PaymentReceiver(address(0), bytes32(uint256(1)));
    }
}
