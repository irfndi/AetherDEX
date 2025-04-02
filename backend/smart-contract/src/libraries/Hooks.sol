// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.29;

import {PoolKey} from "../types/PoolKey.sol";
import {IPoolManager} from "../interfaces/IPoolManager.sol";
import {BalanceDelta} from "../interfaces/IPoolManager.sol";

/**
 * @title Hooks
 * @notice Library for managing hook permissions and validation
 * @dev Library for implementing hook function selectors for pool callbacks
 */
library Hooks {
    // Hook flags for different permissions
    uint160 internal constant BEFORE_INITIALIZE_FLAG = 1 << 0;
    uint160 internal constant AFTER_INITIALIZE_FLAG = 1 << 1;
    uint160 internal constant BEFORE_MODIFY_POSITION_FLAG = 1 << 2;
    uint160 internal constant AFTER_MODIFY_POSITION_FLAG = 1 << 3;
    uint160 internal constant BEFORE_SWAP_FLAG = 1 << 4;
    uint160 internal constant AFTER_SWAP_FLAG = 1 << 5;
    uint160 internal constant BEFORE_DONATE_FLAG = 1 << 6;
    uint160 internal constant AFTER_DONATE_FLAG = 1 << 7;

    struct Permissions {
        bool beforeInitialize;
        bool afterInitialize;
        bool beforeModifyPosition;
        bool afterModifyPosition;
        bool beforeSwap;
        bool afterSwap;
        bool beforeDonate;
        bool afterDonate;
    }

    /**
     * @notice Validates that a hook address has the required flags
     * @param hookAddress The address of the hook to validate
     * @param requiredFlags The flags that must be present in the hook address
     */
    function validateHookAddress(address hookAddress, uint160 requiredFlags) internal pure {
        // Mask out the non-flag bits of the hook address
        uint160 hookFlags = uint160(hookAddress) & ((1 << 8) - 1);

        // Make sure the hook address has all required flags
        require((hookFlags & requiredFlags) == requiredFlags, "Hook address missing required flags");
    }

    /**
     * @notice Converts hook permissions to flags
     * @param permissions The permissions struct to convert
     * @return flags The permissions as a bitmask
     */
    function permissionsToFlags(Permissions memory permissions) internal pure returns (uint160) {
        return (permissions.beforeInitialize ? BEFORE_INITIALIZE_FLAG : 0)
            | (permissions.afterInitialize ? AFTER_INITIALIZE_FLAG : 0)
            | (permissions.beforeModifyPosition ? BEFORE_MODIFY_POSITION_FLAG : 0)
            | (permissions.afterModifyPosition ? AFTER_MODIFY_POSITION_FLAG : 0)
            | (permissions.beforeSwap ? BEFORE_SWAP_FLAG : 0) | (permissions.afterSwap ? AFTER_SWAP_FLAG : 0)
            | (permissions.beforeDonate ? BEFORE_DONATE_FLAG : 0) | (permissions.afterDonate ? AFTER_DONATE_FLAG : 0);
    }

    /**
     * @notice Checks if a hook address has a specific permission
     * @param hookAddress The address of the hook to check
     * @param flag The permission flag to check for
     * @return hasPermission True if the hook has the permission
     */
    function hasPermission(address hookAddress, uint160 flag) internal pure returns (bool) {
        return (uint160(hookAddress) & flag) != 0;
    }

    // Define static selectors for each hook method
    bytes4 internal constant BEFORE_SWAP_SELECTOR =
        bytes4(keccak256("beforeSwap(address,PoolKey,IPoolManager.SwapParams,bytes)"));

    bytes4 internal constant AFTER_SWAP_SELECTOR =
        bytes4(keccak256("afterSwap(address,PoolKey,IPoolManager.SwapParams,BalanceDelta,bytes)"));

    bytes4 internal constant BEFORE_MODIFY_POSITION_SELECTOR =
        bytes4(keccak256("beforeModifyPosition(address,PoolKey,IPoolManager.ModifyPositionParams,bytes)"));

    bytes4 internal constant AFTER_MODIFY_POSITION_SELECTOR =
        bytes4(keccak256("afterModifyPosition(address,PoolKey,IPoolManager.ModifyPositionParams,BalanceDelta,bytes)"));

    function beforeSwap(
        address /*sender*/,
        PoolKey memory /*key*/,
        IPoolManager.SwapParams memory /*params*/,
        bytes memory /*hookData*/
    ) internal pure returns (bytes4) {
        return BEFORE_SWAP_SELECTOR;
    }

    function afterSwap(
        address /*sender*/,
        PoolKey memory /*key*/,
        IPoolManager.SwapParams memory /*params*/,
        BalanceDelta memory /*delta*/,
        bytes memory /*hookData*/
    ) internal pure returns (bytes4) {
        return AFTER_SWAP_SELECTOR;
    }

    function beforeModifyPosition(
        address /*sender*/,
        PoolKey memory /*key*/,
        IPoolManager.ModifyPositionParams memory /*params*/,
        bytes memory /*data*/
    ) internal pure returns (bytes4) {
        return BEFORE_MODIFY_POSITION_SELECTOR;
    }

    function afterModifyPosition(
        address /*sender*/,
        PoolKey memory /*key*/,
        IPoolManager.ModifyPositionParams memory /*params*/,
        BalanceDelta memory /*delta*/,
        bytes memory /*data*/
    ) internal pure returns (bytes4) {
        return AFTER_MODIFY_POSITION_SELECTOR;
    }
}
