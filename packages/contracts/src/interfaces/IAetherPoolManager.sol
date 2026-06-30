// SPDX-License-Identifier: MIT
pragma solidity ^0.8.31;

import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";

/// @title IAetherPoolManager
/// @notice Minimal interface for AetherDEX interaction with Uniswap V4 PoolManager
/// @dev Delegates to the full IPoolManager for all pool operations
interface IAetherPoolManager {
    /// @notice Initialize a new pool
    function initialize(PoolKey memory key, uint160 sqrtPriceX96) external returns (int24 tick);
}
