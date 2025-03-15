// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.29; // UPDATED PRAGMA VERSION TO 0.8.29

import {IPoolManager, BalanceDelta} from "../../src/interfaces/IPoolManager.sol";
import {PoolKey} from "../../src/types/PoolKey.sol";

// Define IHooks interface for testing
interface IHooks {
    function beforeSwap(
        address sender,
        PoolKey calldata key,
        IPoolManager.SwapParams calldata params,
        bytes calldata data
    ) external returns (bytes4);

    function afterSwap(
        address sender,
        PoolKey calldata key,
        IPoolManager.SwapParams calldata params,
        BalanceDelta memory delta,
        bytes calldata data
    ) external returns (bytes4);

    function beforeModifyPosition(
        address sender,
        PoolKey calldata key,
        IPoolManager.ModifyPositionParams calldata params,
        bytes calldata data
    ) external returns (bytes4);

    function afterModifyPosition(
        address sender,
        PoolKey calldata key,
        IPoolManager.ModifyPositionParams calldata params,
        BalanceDelta memory delta,
        bytes calldata data
    ) external returns (bytes4);
}

/**
 * @title MockPoolManager
 * @dev A mock implementation of the IPoolManager interface for testing hooks
 */
contract MockPoolManager {
    // Tracking variables to verify hook calls
    bool public beforeSwapCalled;
    bool public afterSwapCalled;
    bool public beforeModifyPositionCalled;
    bool public afterModifyPositionCalled;

    // Current balance delta for testing
    BalanceDelta private balanceDelta;

    // Mapping to track initialized pools
    mapping(bytes32 => bool) public pools;

    /**
     * @notice Initialize a new pool
     * @param key The pool key identifying the pool
     */
    function initialize(PoolKey calldata key) external returns (int24 tick) {
        bytes32 poolId = keccak256(abi.encode(key));
        pools[poolId] = true;
        return 0; // Initial tick
    }

    /**
     * @notice Set the balance delta for testing
     * @param amount0 The delta for token0
     * @param amount1 The delta for token1
     */
    function setBalanceDelta(int256 amount0, int256 amount1) external {
        balanceDelta = BalanceDelta(amount0, amount1);
    }

    /**
     * @notice Get the current balance delta
     * @return The current balance delta
     */
    function getBalanceDelta() external view returns (BalanceDelta memory) {
        return balanceDelta;
    }

    /**
     * @notice Mock implementation of the swap function
     */
    function swap(PoolKey calldata key, IPoolManager.SwapParams calldata params, bytes calldata hookData)
        external
        returns (BalanceDelta memory delta)
    {
        // Verify the pool exists
        bytes32 poolId = keccak256(abi.encode(key));
        require(pools[poolId], "Pool not initialized");

        // Call hooks
        if (address(key.hooks) != address(0)) {
            beforeSwapCalled = true;
            // Call beforeSwap hook
            bytes4 selector = IHooks(key.hooks).beforeSwap(msg.sender, key, params, hookData);
            require(selector == IHooks.beforeSwap.selector, "Invalid beforeSwap selector");

            // Simulate swap

            afterSwapCalled = true;
            // Call afterSwap hook
            selector = IHooks(key.hooks).afterSwap(msg.sender, key, params, balanceDelta, hookData);
            require(selector == IHooks.afterSwap.selector, "Invalid afterSwap selector");
        }

        return balanceDelta;
    }

    /**
     * @notice Mock implementation of the modifyPosition function
     */
    function modifyPosition(
        PoolKey calldata key,
        IPoolManager.ModifyPositionParams calldata params,
        bytes calldata hookData
    ) external returns (BalanceDelta memory delta) {
        // Verify the pool exists
        bytes32 poolId = keccak256(abi.encode(key));
        require(pools[poolId], "Pool not initialized");

        // Call hooks
        if (address(key.hooks) != address(0)) {
            beforeModifyPositionCalled = true;
            // Call beforeModifyPosition hook
            bytes4 selector = IHooks(key.hooks).beforeModifyPosition(msg.sender, key, params, hookData);
            require(selector == IHooks.beforeModifyPosition.selector, "Invalid beforeModifyPosition selector");

            // Simulate position modification

            afterModifyPositionCalled = true;
            // Call afterModifyPosition hook
            selector = IHooks(key.hooks).afterModifyPosition(msg.sender, key, params, balanceDelta, hookData);
            require(selector == IHooks.afterModifyPosition.selector, "Invalid afterModifyPosition selector");
        }

        return balanceDelta;
    }
}
