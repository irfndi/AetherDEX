// SPDX-License-Identifier: GPL-3.0
// IFeeRegistry.sol
pragma solidity ^0.8.28; // Consistent pragma version

import {PoolKey} from "../types/PoolKey.sol";

/**
 * @title IFeeRegistry
 * @dev Interface for the fee registry contract that manages dynamic fees for token pairs.
 * This registry is used by the DynamicFeeHook to determine the appropriate fee for swaps
 * based on various factors like trading volume and volatility.
 */
interface IFeeRegistry {
    /**
     * @dev Defines the configuration for a fee tier.
     * @param fee The swap fee percentage (in hundredths of a basis point).
     * @param tickSpacing The distance between usable ticks for this fee tier.
     */
    struct FeeConfiguration {
        uint24 fee;
        int24 tickSpacing;
    }
    /**
 * @notice Gets the current fee for a pool identified by its key.
 * @dev Returns the fee tier in hundredths of a basis point (0.0001%).
 * @param key The PoolKey identifying the pool (tokens, fee, tick spacing, hooks).
 * @return The current fee tier for the pool.
 */
    function getFee(PoolKey calldata key) external view returns (uint24);

    /**
     * @notice Updates the fee for a pool based on swap activity.
     * @dev Called by the DynamicFeeHook after swaps to adjust fees based on market conditions.
     * @param key The PoolKey identifying the pool.
     * @param swapVolume The volume of the swap that triggered this update.
     */
    function updateFee(PoolKey calldata key, uint256 swapVolume) external;
}
