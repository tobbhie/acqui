// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @dev Test-only USDC mock: 6 decimals, open mint, Arc-style blocklist, optional reentrancy hook.
contract MockUSDC is ERC20 {
    error Blocklisted(address account);

    mapping(address => bool) public blocklisted;

    // Reentrancy hook: fires once, during a (non-mint) transfer whose `to` matches hookOnTo
    // (address(0) matches any recipient). The call is made from this token to hookTarget.
    address public hookTarget;
    address public hookOnTo;
    bytes public hookData;
    bool public hookArmed;
    bool public hookCalled;
    bool public hookSuccess;
    bytes public hookReturn;

    constructor() ERC20("Mock USDC", "mUSDC") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function setBlocklisted(address account, bool status) external {
        blocklisted[account] = status;
    }

    function armHook(address target, bytes calldata data, address onTo) external {
        hookTarget = target;
        hookData = data;
        hookOnTo = onTo;
        hookArmed = true;
        hookCalled = false;
        hookSuccess = false;
        delete hookReturn;
    }

    function _update(address from, address to, uint256 value) internal override {
        if (blocklisted[from]) revert Blocklisted(from);
        if (blocklisted[to]) revert Blocklisted(to);
        if (from != address(0) && hookArmed && (hookOnTo == address(0) || hookOnTo == to)) {
            hookArmed = false;
            hookCalled = true;
            (bool ok, bytes memory ret) = hookTarget.call(hookData);
            hookSuccess = ok;
            hookReturn = ret;
        }
        super._update(from, to, value);
    }
}

/// @dev 18-decimals token for constructor decimals-check tests.
contract MockUSDC18 is ERC20 {
    constructor() ERC20("Bad", "BAD") {}
}

/// @dev Contract with code but no decimals() function.
contract NoDecimalsToken {}
