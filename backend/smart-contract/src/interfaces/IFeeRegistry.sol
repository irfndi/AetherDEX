// SPDX-License-Identifier: GPL-3.0
// IFeeRegistry.sol
pragma solidity ^0.8.29; // UPDATED PRAGMA VERSION TO 0.8.28
/**
 * @title IFeeRegistry
 * @dev Interface for the fee registry contract that manages dynamic fees for token pairs.
 * This registry is used by the DynamicFeeHook to determine the appropriate fee for swaps
 * based on various factors like trading volume and volatility.
 */

interface IFeeRegistry {
    /**
     * @notice Gets the current fee for a token pair
     * @dev Returns the fee tier in hundredths of a basis point (0.0001%)
     * @param token0 The address of the first token in the pair
     * @param token1 The address of the second token in the pair
     * @return The current fee tier for the token pair
     */
    function getFee(address token0, address token1) external view returns (uint24);

    /**
     * @notice Updates the fee for a token pair based on swap activity
     * @dev Called by the DynamicFeeHook after swaps to adjust fees based on market conditions
     * @param token0 The address of the first token in the pair
     * @param token1 The address of the second token in the pair
     * @param swapVolume The volume of the swap that triggered this update
     */
    function updateFee(address token0, address token1, uint256 swapVolume) external;
}
