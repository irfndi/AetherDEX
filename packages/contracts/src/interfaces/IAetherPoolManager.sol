// SPDX-License-Identifier: MIT
pragma solidity ^0.8.31;

import { PoolKey } from "../types/PoolKey.sol";

/// @title IAetherPoolManager
/// @notice Interface for the AetherDEX pool manager (wraps Uniswap V4 PoolManager)
interface IAetherPoolManager {
    /// @notice Initialize a new pool
    function initialize(PoolKey memory key) external returns (int24 currentTick);

    /// @notice Execute a swap
    function swap(
        PoolKey memory key,
        bool zeroForOne,
        int256 amountSpecified,
        uint160 sqrtPriceLimitX96,
        bytes calldata hookData
    ) external returns (int256 amount0, int256 amount1);
}
