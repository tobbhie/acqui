// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @notice Minimal custody address whose only transfer authority is its immutable distributor.
/// @dev Sub-base-unit native dust and non-USDC tokens cannot be recovered by the distributor.
contract PaymentReceiver {
    using SafeERC20 for IERC20;

    error UnauthorizedDistributor();
    error ZeroDistributor();

    /// @notice The sole address authorized to pull tokens.
    address public immutable distributor;
    /// @notice Chain-bound commitment to the checkout attempt.
    bytes32 public immutable termsHash;

    /// @notice Bind this receiver permanently to its distributor and terms.
    constructor(address distributor_, bytes32 termsHash_) {
        if (distributor_ == address(0)) revert ZeroDistributor();
        distributor = distributor_;
        termsHash = termsHash_;
    }

    /// @notice Accept native USDC after deployment without executing any accounting logic.
    receive() external payable {}

    /// @notice Transfer tokens only when called by the immutable distributor.
    /// @param token ERC-20 token to transfer.
    /// @param to Fixed destination selected by distributor logic.
    /// @param amount Amount in the token's base units.
    function pull(IERC20 token, address to, uint256 amount) external {
        if (msg.sender != distributor) revert UnauthorizedDistributor();
        token.safeTransfer(to, amount);
    }
}
