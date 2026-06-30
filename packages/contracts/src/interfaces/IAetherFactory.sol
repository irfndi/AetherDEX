// SPDX-License-Identifier: MIT
pragma solidity ^0.8.31;

import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";

/// @title IAetherFactory
/// @notice Interface for AetherDEX pool factory
interface IAetherFactory {
    /// @notice Create and initialize a new pool
    /// @param token0 First token (must be sorted < token1)
    /// @param token1 Second token
    /// @param fee Pool fee tier (e.g. 3000 = 0.3%)
    /// @param tickSpacing Tick spacing for concentrated liquidity
    /// @param sqrtPriceX96 Initial sqrt price as Q64.96
    /// @return poolId The keccak256-encoded PoolKey identifier
    function createPool(
        address token0,
        address token1,
        uint24 fee,
        int24 tickSpacing,
        uint160 sqrtPriceX96
    ) external returns (bytes32 poolId);

    /// @notice Get pool key by ID
    /// @param poolId The keccak256-encoded PoolKey identifier
    /// @return The PoolKey for the given pool
    function getPool(bytes32 poolId) external view returns (PoolKey memory);

    /// @notice Total number of registered pools
    function poolCount() external view returns (uint256);

    /// @notice Get pool key at index
    /// @param index Index in the allPools array
    /// @return The PoolKey at the given index
    function getPoolAt(uint256 index) external view returns (PoolKey memory);
}
