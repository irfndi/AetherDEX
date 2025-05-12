// SPDX-License-Identifier: GPL-3.0

/*
Created by irfndi (github.com/irfndi) - Apr 2025
Email: join.mantap@gmail.com
*/

pragma solidity ^0.8.29;

import {IPoolManager} from "../interfaces/IPoolManager.sol";
import {Hooks} from "../libraries/Hooks.sol";
import {PoolKey} from "../types/PoolKey.sol";
import {BalanceDelta} from "../types/BalanceDelta.sol";

/**
 * @title BaseHook
 * @notice Abstract contract that implements basic hook functionality
 * @dev All hook contracts should inherit from this base contract
 */
abstract contract BaseHook {
    /// @notice Reference to the pool manager contract
    IPoolManager public immutable poolManager;

    error HookMismatchedAddressFlags();
    error InvalidHookAddress();

    constructor(address _poolManager) {
        poolManager = IPoolManager(_poolManager);
    }

    function getHookPermissions() public pure virtual returns (Hooks.Permissions memory);

    // Hook functions that can be implemented by derived contracts
    function beforeInitialize(address, PoolKey calldata, uint160, bytes calldata) external virtual returns (bytes4) {
        return BaseHook.beforeInitialize.selector;
    }

    function afterInitialize(address, PoolKey calldata, uint160, bytes calldata) external virtual returns (bytes4) {
        return BaseHook.afterInitialize.selector;
    }

    function beforeModifyPosition(address, PoolKey calldata, IPoolManager.ModifyPositionParams calldata, bytes calldata)
        external
        virtual
        returns (bytes4)
    {
        return BaseHook.beforeModifyPosition.selector;
    }

    function afterModifyPosition(
        address,
        PoolKey calldata,
        IPoolManager.ModifyPositionParams calldata,
        BalanceDelta memory,
        bytes calldata
    ) external virtual returns (bytes4) {
        return BaseHook.afterModifyPosition.selector;
    }

    function beforeSwap(address, PoolKey calldata, IPoolManager.SwapParams calldata, bytes calldata)
        external
        virtual
        returns (bytes4)
    {
        return BaseHook.beforeSwap.selector;
    }

    function afterSwap(address, PoolKey calldata, IPoolManager.SwapParams calldata, BalanceDelta memory, bytes calldata)
        external
        virtual
        returns (bytes4)
    {
        return BaseHook.afterSwap.selector;
    }

    function beforeDonate(address, PoolKey calldata, uint256, uint256, bytes calldata)
        external
        virtual
        returns (bytes4)
    {
        return BaseHook.beforeDonate.selector;
    }

    function afterDonate(address, PoolKey calldata, uint256, uint256, bytes calldata)
        external
        virtual
        returns (bytes4)
    {
        return BaseHook.afterDonate.selector;
    }
}
