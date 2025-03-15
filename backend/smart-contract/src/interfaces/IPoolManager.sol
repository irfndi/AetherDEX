// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.29; // UPDATED PRAGMA VERSION TO 0.8.29
// IPoolManager.sol
/**
 * @title IPoolManager
 * @dev Interface for the pool manager contract that handles all pool operations.
 * This interface follows the Uniswap V4 pattern and defines the core functionality
 * for interacting with liquidity pools in the AetherDEX ecosystem.
 */

interface IPoolManager {
    /**
     * @dev Parameters for swap operations
     * @param amountSpecified The amount of tokens to swap, positive for exact input, negative for exact output
     * @param sqrtPriceLimitX96 The price limit for the swap in Q64.96 format
     * @param zeroForOne The direction of the swap (true for token0 to token1, false for token1 to token0)
     */
    struct SwapParams {
        int256 amountSpecified;
        uint160 sqrtPriceLimitX96;
        bool zeroForOne;
    }

    /**
     * @dev Parameters for modifying a position (adding or removing liquidity)
     * @param tickLower The lower tick boundary of the position
     * @param tickUpper The upper tick boundary of the position
     * @param liquidityDelta The amount of liquidity to add (positive) or remove (negative)
     */
    struct ModifyPositionParams {
        int24 tickLower;
        int24 tickUpper;
        int256 liquidityDelta;
    }
}

/**
 * @dev Represents the change in token balances after an operation
 * @param amount0 The change in balance of token0 (positive for increase, negative for decrease)
 * @param amount1 The change in balance of token1 (positive for increase, negative for decrease)
 */
struct BalanceDelta {
    int256 amount0;
    int256 amount1;
}
