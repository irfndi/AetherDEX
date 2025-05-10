// SPDX-License-Identifier: GPL-3.0

/*
Created by irfndi (github.com/irfndi) - Apr 2025
Email: join.mantap@gmail.com
*/

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
