// SPDX-License-Identifier: MIT
pragma solidity ^0.8.31;

import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";

/// @title AetherHookAddressMiner
/// @notice Utility to validate hook deployment addresses have correct permission flags
library AetherHookAddressMiner {
    /// @notice The required hook permissions for AetherHook
    uint160 internal constant REQUIRED_FLAGS =
        Hooks.BEFORE_SWAP_FLAG | Hooks.AFTER_SWAP_FLAG;

    /// @notice Check if an address has the correct hook permission flags
    /// @param hookAddress The deployed hook address to validate
    /// @return True if the address has BEFORE_SWAP_FLAG | AFTER_SWAP_FLAG set
    function hasValidFlags(address hookAddress) internal pure returns (bool) {
        return uint160(hookAddress) & REQUIRED_FLAGS == REQUIRED_FLAGS;
    }

    /// @notice Find a CREATE2 salt that produces a hook address with the correct flags
    /// @param deployer The deployer address (msg.sender of the CREATE2)
    /// @param initCodeHash The keccak256 of the creation code (without constructor args)
    /// @param maxIterations Maximum number of salts to try
    /// @return found Whether a valid salt was found
    /// @return salt The salt that produces a valid address
    /// @return hookAddress The resulting hook address
    function findSalt(address deployer, bytes32 initCodeHash, uint256 maxIterations)
        internal
        pure
        returns (bool found, bytes32 salt, address hookAddress)
    {
        for (uint256 i = 0; i < maxIterations; i++) {
            bytes32 currentSalt = bytes32(i);
            bytes32 hash = keccak256(abi.encodePacked(bytes1(0xff), deployer, currentSalt, initCodeHash));
            address candidate = address(uint160(uint256(hash)));

            if (uint160(candidate) & REQUIRED_FLAGS == REQUIRED_FLAGS) {
                return (true, currentSalt, candidate);
            }
        }
        return (false, bytes32(0), address(0));
    }
}
