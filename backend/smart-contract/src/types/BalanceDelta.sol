// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.29;

/**
 * @title BalanceDelta
 * @dev A struct representing the change in balances after a swap or position modification
 */
struct BalanceDelta {
    int256 amount0;
    int256 amount1;
}
