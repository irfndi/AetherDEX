// SPDX-License-Identifier: MIT
pragma solidity ^0.8.31;

/// @title PoolKey
/// @notice Identifies a pool in AetherDEX
struct PoolKey {
    address token0;
    address token1;
    uint24 fee;
    int24 tickSpacing;
}
