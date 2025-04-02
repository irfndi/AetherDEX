// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.29;

/// @title Pool Key struct
/// @notice Contains all the necessary information to identify a pool
struct PoolKey {
    address token0;
    address token1;
    uint24 fee;
    int24 tickSpacing;
    address hooks;
}
