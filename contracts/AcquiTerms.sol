// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @notice Immutable checkout-attempt parameters; all amounts use USDC base units (6 decimals).
struct Terms {
    bytes32 intentId;
    bytes32 attemptId;
    address merchant;
    address refundAddress;
    uint256 amount;
    uint64 expiry;
    uint16 feeBps;
    uint256 minFee;
    uint256 keeperReimbursement;
}

/// @notice Canonical, chain-bound hashing of checkout terms.
library AcquiTerms {
    bytes32 internal constant TERMS_TYPEHASH = keccak256(
        "Terms(uint256 chainId,bytes32 intentId,bytes32 attemptId,address merchant,address refundAddress,uint256 amount,uint64 expiry,uint16 feeBps,uint256 minFee,uint256 keeperReimbursement)"
    );

    /// @notice Hash all terms together with the current chain ID.
    function hash(Terms memory t) internal view returns (bytes32) {
        return keccak256(
            abi.encode(
                TERMS_TYPEHASH,
                block.chainid,
                t.intentId,
                t.attemptId,
                t.merchant,
                t.refundAddress,
                t.amount,
                t.expiry,
                t.feeBps,
                t.minFee,
                t.keeperReimbursement
            )
        );
    }
}
