// SPDX-License-Identifier: GPL-3.0
// PoolKey.sol
pragma solidity ^0.8.29; // UPDATED PRAGMA VERSION TO 0.8.28
/**
 * @title PoolKey
 * @dev Struct that uniquely identifies a pool in the AetherDEX ecosystem.
 * This struct is used as a key for pool operations and follows the Uniswap V4 pattern.
 */

struct PoolKey {
    /**
     * @dev The address of the first token in the pair (sorted by address)
     */
    address currency0;
    /**
     * @dev The address of the second token in the pair (sorted by address)
     */
    address currency1;
    /**
     * @dev The fee tier for the pool, expressed in hundredths of a basis point (0.0001%)
     * For example, a fee of 500 represents a 0.05% fee
     */
    uint24 fee;
    /**
     * @dev The spacing between initialized ticks, used for concentrated liquidity
     * Smaller tick spacing allows for more precise price ranges but uses more gas
     */
    int24 tickSpacing;
    /**
     * @dev The address of the hooks contract that extends the pool's functionality
     * Can be address(0) if no hooks are needed
     */
    address hooks;
}
