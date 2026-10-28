// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {PaymentReceiver} from "./PaymentReceiver.sol";

/// @notice Permissionless deterministic deployment of immutable payment receivers.
contract PaymentFactory {
    error ZeroAddress();

    /// @notice Distributor embedded in every receiver deployed by this factory.
    address public immutable distributor;
    /// @notice Chain ID at factory deployment.
    uint256 public immutable DEPLOYED_CHAIN_ID;
    /// @notice Receiver registry; zero denotes an unregistered terms hash.
    mapping(address => bytes32) public termsHashOf;

    /// @notice Emitted only when a new receiver is deployed.
    /// @param termsHash Commitment used as the CREATE2 salt.
    /// @param receiver Newly deployed receiver address.
    event ReceiverDeployed(bytes32 indexed termsHash, address indexed receiver);

    /// @notice Permanently bind deployments to the supplied distributor.
    constructor(address distributor_) {
        if (distributor_ == address(0)) revert ZeroAddress();
        distributor = distributor_;
        DEPLOYED_CHAIN_ID = block.chainid;
    }

    /// @notice Predict a receiver using its exact creation code and immutable arguments.
    function predictReceiver(bytes32 termsHash) public view returns (address) {
        bytes32 initCodeHash = keccak256(
            abi.encodePacked(type(PaymentReceiver).creationCode, abi.encode(distributor, termsHash))
        );
        return address(uint160(uint256(keccak256(abi.encodePacked(
            bytes1(0xff), address(this), termsHash, initCodeHash
        )))));
    }

    /// @notice Deploy a receiver permissionlessly, or return its address if already deployed.
    function deployReceiver(bytes32 termsHash) external returns (address receiver) {
        receiver = predictReceiver(termsHash);
        if (receiver.code.length != 0) return receiver;
        receiver = address(new PaymentReceiver{salt: termsHash}(distributor, termsHash));
        termsHashOf[receiver] = termsHash;
        emit ReceiverDeployed(termsHash, receiver);
    }

    /// @notice Whether this factory registered a nonzero terms hash for the receiver.
    function isRegistered(address receiver) external view returns (bool) {
        return termsHashOf[receiver] != bytes32(0);
    }
}
