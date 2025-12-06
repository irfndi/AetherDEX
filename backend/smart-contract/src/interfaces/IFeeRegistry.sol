// SPDX-License-Identifier: GPL-3.0

/*
Created by irfndi (github.com/irfndi) - Apr 2025
Email: join.mantap@gmail.com
*/

pragma solidity ^0.8.29;

import "../../lib/v4-core/src/types/PoolKey.sol";

/**
 * @title Interface for FeeRegistry
 * @notice Defines the external functions exposed by FeeRegistry.sol.
 * @dev Manages fee configurations for Aether pools.
 */
interface IFeeRegistry {
    // --- Events ---
    event FeeConfigurationAdded( // Assuming tickSpacing might still be relevant for pool creation
        address indexed token0,
        address indexed token1,
        uint24 fee,
        int24 tickSpacing
    );
    event DynamicFeeUpdated(address indexed token0, address indexed token1, uint24 oldFee, uint24 newFee);
    event StaticFeeSet(address indexed token0, address indexed token1, uint24 fee);
    event DynamicFeeUpdaterSet(address indexed updater, bool allowed);

    // --- Structs ---
    struct FeeConfiguration {
        bool isStatic;
        uint24 fee;
        uint24 tickSpacing;
    }
    // Add other relevant fields if FeeRegistry stores more config per pair

    // --- Functions ---

    /**
     * @notice Adds a new fee configuration for a token pair.
     * @dev Only callable by the owner.
     * @param tokenA Address of the first token.
     * @param tokenB Address of the second token.
     * @param fee The fee tier (e.g., 3000 for 0.3%).
     * @param tickSpacing The tick spacing for this fee tier (if applicable).
     * @param isStatic_ Whether the fee is static or dynamic.
     */
    function addFeeConfiguration(address tokenA, address tokenB, uint24 fee, int24 tickSpacing, bool isStatic_) external;

    /**
     * @notice Sets or updates the static fee for a specific token pair.
     * @dev Only callable by the owner.
     * @param tokenA Address of the first token.
     * @param tokenB Address of the second token.
     * @param fee The static fee tier.
     */
    function setStaticFee(address tokenA, address tokenB, uint24 fee) external;

    /**
     * @notice Updates the dynamic fee for a specific token pair.
     * @dev Only callable by an authorized updater or the owner.
     * @param tokenA Address of the first token.
     * @param tokenB Address of the second token.
     * @param newFee The new dynamic fee tier.
     */
    function updateDynamicFee(address tokenA, address tokenB, uint24 newFee) external;

    /**
     * @notice Gets the fee configuration for a token pair.
     * @param tokenA Address of the first token.
     * @param tokenB Address of the second token.
     * @return config The FeeConfiguration struct for the pair.
     */
    function getFeeConfiguration(address tokenA, address tokenB) external view returns (FeeConfiguration memory config);

    /**
     * @notice Gets the current applicable fee for a token pair.
     * @param tokenA Address of the first token.
     * @param tokenB Address of the second token.
     * @return fee The current fee (static or dynamic).
     */
    function getCurrentFee(address tokenA, address tokenB) external view returns (uint24 fee);

    /**
     * @notice Gets the current applicable fee for a pool key.
     * @param key The pool key containing token addresses and other pool parameters.
     * @return fee The current fee (static or dynamic).
     */
    function getFee(PoolKey calldata key) external view returns (uint24 fee);

    /**
     * @notice Updates the dynamic fee for a registered pool based on recent swap volume.
     * @dev Only callable by the authorized fee updater for the pool.
     * @param key The PoolKey identifying the pool.
     * @param swapVolume The recent swap volume used to potentially adjust the fee.
     */
    function updateFee(PoolKey calldata key, uint256 swapVolume) external;

    /**
     * @notice Authorizes or deauthorizes an address to update dynamic fees.
     * @dev Only callable by the owner.
     * @param updater The address of the updater.
     * @param allowed True to allow, false to disallow.
     */
    function setDynamicFeeUpdater(address updater, bool allowed) external;

    /**
     * @notice Checks if an address is an authorized dynamic fee updater.
     * @param updater The address to check.
     * @return isAllowed True if the address is allowed, false otherwise.
     */
    function isDynamicFeeUpdater(address updater) external view returns (bool isAllowed);
}
