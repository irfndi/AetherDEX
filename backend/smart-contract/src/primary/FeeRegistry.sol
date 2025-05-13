// SPDX-License-Identifier: GPL-3.0

/*
Created by irfndi (github.com/irfndi) - Apr 2025
Email: join.mantap@gmail.com
*/

pragma solidity ^0.8.29;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {PoolKey} from "../types/PoolKey.sol";

/// @title Fee Registry
/// @notice Manages both static fee configurations (fee tier and tick spacing) and dynamic fees for specific Aether Pools.
/// Allows the owner to add static configurations and register pools for dynamic fee updates by authorized addresses (e.g., hooks).
contract FeeRegistry is Ownable {
    // --- Constants for Dynamic Fee Adjustments ---
    uint24 private constant MIN_FEE = 100; // 0.01%
    uint24 private constant MAX_FEE = 100000; // 10.00% to match DynamicFeeHook.sol
    uint24 private constant FEE_STEP = 50; // 0.005%

    // --- State Variables ---

    /// @notice Mapping from a static fee tier to its required tick spacing.
    /// @dev Used for pools that do not use dynamic fees. A non-zero value indicates the fee tier is supported.
    mapping(uint24 => int24) public tickSpacings;

    /// @notice Mapping from the hash of a PoolKey to its dynamically set fee.
    /// @dev If a fee exists here, it overrides any static configuration for that specific pool.
    /// A non-zero value indicates the pool is registered for dynamic fees.
    mapping(bytes32 => uint24) public dynamicFees;

    /// @notice Mapping from the hash of a PoolKey to the address authorized to update its dynamic fee.
    /// @dev Only this address can call `updateFee` for the given pool.
    mapping(bytes32 => address) public feeUpdaters;

    // --- Events ---

    /// @notice Emitted when a new static fee configuration is added.
    /// @param fee The fee tier added.
    /// @param tickSpacing The tick spacing associated with the fee.
    event FeeConfigurationAdded(uint24 indexed fee, int24 indexed tickSpacing);

    /// @notice Emitted when a pool is registered for dynamic fee updates.
    /// @param poolKeyHash The hash of the PoolKey identifying the pool.
    /// @param initialFee The initial dynamic fee set for the pool.
    /// @param updater The address authorized to update the fee.
    event DynamicFeePoolRegistered(bytes32 indexed poolKeyHash, uint24 initialFee, address indexed updater);

    /// @notice Emitted when the authorized fee updater for a dynamic pool is changed.
    /// @param poolKeyHash The hash of the PoolKey identifying the pool.
    /// @param oldUpdater The previously authorized updater address.
    /// @param newUpdater The newly authorized updater address.
    event FeeUpdaterSet(bytes32 indexed poolKeyHash, address indexed oldUpdater, address indexed newUpdater);

    /// @notice Emitted when the dynamic fee for a pool is updated.
    /// @param poolKeyHash The hash of the PoolKey identifying the pool.
    /// @param updater The address that performed the update.
    /// @param newFee The new dynamic fee value.
    event DynamicFeeUpdated(bytes32 indexed poolKeyHash, address indexed updater, uint24 newFee);

    // --- Errors ---

    /// @notice Error thrown when trying to add a static fee configuration that already exists.
    /// @param fee The fee tier that already exists.
    error FeeAlreadyExists(uint24 fee);

    /// @notice Error thrown when trying to add a fee configuration with invalid parameters (e.g., fee is 0).
    error InvalidFeeConfiguration();

    /// @notice Error thrown when querying a fee tier that is not supported or registered.
    /// @param fee The fee tier queried.
    error FeeTierNotSupported(uint24 fee);

    /// @notice Error thrown when querying a tick spacing that is not supported by any fee tier.
    /// @param tickSpacing The tick spacing queried.
    error TickSpacingNotSupported(int24 tickSpacing);

    /// @notice Error thrown when trying to update a pool not registered for dynamic fees.
    /// @param poolKeyHash The hash of the PoolKey.
    error PoolNotRegistered(bytes32 poolKeyHash);

    /// @notice Error thrown when an unauthorized address tries to update a dynamic fee.
    /// @param poolKeyHash The hash of the PoolKey.
    /// @param caller The address attempting the update.
    /// @param expectedUpdater The authorized updater address.
    error UnauthorizedUpdater(bytes32 poolKeyHash, address caller, address expectedUpdater);

    /// @notice Error thrown when trying to update a dynamic fee with an invalid value.
    error InvalidDynamicFee();

    /// @notice Error thrown when trying to register a pool with an invalid initial fee.
    error InvalidInitialFee(uint24 fee);

    /// @notice Error thrown during registration if the initial fee or updater address is invalid.
    /// @param poolKeyHash The hash of the PoolKey.
    /// @param initialFee The initial fee provided.
    /// @param updater The updater address provided.
    error InvalidInitialFeeOrUpdater(bytes32 poolKeyHash, uint24 initialFee, address updater);

    /// @notice Error thrown when trying to register a pool that is already registered for dynamic fees.
    /// @param poolKeyHash The hash of the PoolKey.
    error PoolAlreadyRegistered(bytes32 poolKeyHash);

    /// @notice Error thrown when trying to set an invalid new updater address (e.g., zero address).
    /// @param poolKeyHash The hash of the PoolKey.
    /// @param invalidUpdater The invalid updater address provided.
    error InvalidNewUpdater(bytes32 poolKeyHash, address invalidUpdater);

    /// @notice Error thrown when trying to set the new updater to the same address as the current one.
    /// @param poolKeyHash The hash of the PoolKey.
    /// @param updater The address provided which is the same as the current updater.
    error NewUpdaterSameAsOld(bytes32 poolKeyHash, address updater);

    /// @notice Constructs the FeeRegistry, setting the deployer as the initial owner.
    constructor() Ownable(msg.sender) {}

    /// @notice Adds a new static fee configuration (fee tier and tick spacing).
    /// @dev Only callable by the owner. Reverts if the fee tier already exists or parameters are invalid.
    /// @param fee The fee tier to add (e.g., 3000 for 0.3%). Must be non-zero.
    /// @param tickSpacing The corresponding tick spacing. Must be positive.
    function addFeeConfiguration(uint24 fee, int24 tickSpacing) external onlyOwner {
        // Add check for MAX_FEE
        if (fee == 0 || fee > MAX_FEE || tickSpacing <= 0) {
            revert InvalidFeeConfiguration();
        }
        // Check if tickSpacing is non-zero, indicating the fee tier already exists
        if (tickSpacings[fee] != 0) {
            revert FeeAlreadyExists(fee);
        }

        tickSpacings[fee] = tickSpacing;
        emit FeeConfigurationAdded(fee, tickSpacing);
    }

    // [REMOVED] getFeeConfiguration function is no longer needed.

    /// @notice Checks if a static fee tier is supported (i.e., has a tick spacing configured).
    /// @param fee The fee tier to check.
    /// @return bool True if the fee tier is supported, false otherwise.
    function isSupportedFeeTier(uint24 fee) external view returns (bool) {
        // A fee tier is supported if its tick spacing is non-zero (meaning it was added)
        return tickSpacings[fee] != 0;
    }

    /// @notice Helper function to get the lowest fee for a given tick spacing
    /// @param tickSpacing The tick spacing to query
    /// @return The lowest fee configured for the tick spacing
    function getLowestFeeForTickSpacing(int24 tickSpacing) internal view returns (uint24) {
        uint24 lowestFee = type(uint24).max;
        for (uint24 fee = MIN_FEE; fee <= MAX_FEE; fee += FEE_STEP) {
            if (tickSpacings[fee] == tickSpacing && fee < lowestFee) {
                lowestFee = fee;
            }
        }
        // Revert with specific error if no fee found for the tick spacing
        // Revert with specific error if no fee found for the tick spacing
        if (lowestFee == type(uint24).max) {
            revert TickSpacingNotSupported(tickSpacing); // Keep this specific error
        }
        return lowestFee;
    }

    /// @notice Returns the fee for a given pool.
    /// @param key The PoolKey identifying the pool.
    /// @return fee The fee for the pool.
    function getFee(PoolKey calldata key) external view returns (uint24 fee) {
        bytes32 poolKeyHash = keccak256(abi.encode(key));
        uint24 dynamicFee = dynamicFees[poolKeyHash];

        // 1. If a dynamic fee exists, return it
        if (dynamicFee != 0) {
            return dynamicFee;
        }

        // 2. Static fee logic:
        // The PoolKey must provide a positive tickSpacing for static fee resolution.
        if (key.tickSpacing <= 0) {
            // If tickSpacing in PoolKey is invalid, we can't determine a static fee configuration.
            // Reverting with FeeTierNotSupported using key.fee might be confusing if key.fee is also 0 or junk.
            // A more direct error could be InvalidTickSpacingInPoolKey, but for now, FeeTierNotSupported
            // implies that the combination or the fee aspect of the key is problematic.
            revert FeeTierNotSupported(key.fee);
        }

        // For static pools, the fee is determined by the lowest configured fee tier
        // associated with the PoolKey's tickSpacing.
        // getLowestFeeForTickSpacing will revert with TickSpacingNotSupported if key.tickSpacing is not configured.
        return getLowestFeeForTickSpacing(key.tickSpacing);
    }

    /// @notice Updates the dynamic fee for a registered pool based on recent swap volume.
    /// @dev Only callable by the authorized fee updater for the pool.
    /// Implements dynamic fee calculation based on swap volume and current market conditions.
    /// @param key The PoolKey identifying the pool.
    /// @param swapVolume The recent swap volume used to potentially adjust the fee.
    function updateFee(PoolKey calldata key, uint256 swapVolume) external {
        bytes32 poolKeyHash = keccak256(abi.encode(key));
        address expectedUpdater = feeUpdaters[poolKeyHash];

        // Check if the pool is registered for dynamic fees
        if (expectedUpdater == address(0)) {
            revert PoolNotRegistered(poolKeyHash);
        }
        // Check if the caller is the authorized updater
        if (msg.sender != expectedUpdater) {
            revert UnauthorizedUpdater(poolKeyHash, msg.sender, expectedUpdater);
        }

        // Get current fee
        uint24 currentFee = dynamicFees[poolKeyHash];

        // Calculate volume-based fee adjustment
        // For larger volumes, increase the fee to account for potential price impact
        // Use a logarithmic scale to prevent excessive fees for very large volumes
        uint256 volumeThreshold = 1000 ether; // 1000 tokens (assuming 18 decimals)
        uint24 feeAdjustment = 0;

        if (swapVolume > 0) {
            uint256 volumeMultiplierRaw = (swapVolume + volumeThreshold - 1) / volumeThreshold;
            uint256 unCappedFeeAdjustment = volumeMultiplierRaw * 50;
            
            // Check bounds using wider types to prevent overflow
            uint256 potentialFeeForBoundCheck = uint256(currentFee) + unCappedFeeAdjustment;
            if (
                potentialFeeForBoundCheck > MAX_FEE ||
                potentialFeeForBoundCheck < MIN_FEE ||
                potentialFeeForBoundCheck > type(uint24).max   // extra safety check
            ) {
                revert InvalidDynamicFee();
            }
            
            // Now that we've verified the bounds, we can safely cast to uint24
            // No need to keep the uncapped adjustment since we've already done the bounds check with wider types

            uint256 volumeMultiplierCapped = volumeMultiplierRaw;
            if (volumeMultiplierCapped > 10) volumeMultiplierCapped = 10; // Cap at 10x
            feeAdjustment = uint24(volumeMultiplierCapped * 50); // This is the capped adjustment for actual use
        }

        // Calculate new fee, ensuring it stays within bounds using the *capped* feeAdjustment
        uint24 calculatedNewFee = currentFee;

        // Only adjust if there's meaningful volume
        if (swapVolume >= volumeThreshold / 10) {
            // Note: The bound check with unCappedFeeAdjustmentForCheck has already been done if swapVolume > 0
            // If swapVolume was 0, feeAdjustment is 0, so currentFee + 0 is checked by subsequent logic.
            // Here, we use the (potentially capped) feeAdjustment for the actual fee setting.
            uint24 potentialNewFee = currentFee + feeAdjustment;

            // Ensure fee is a multiple of FEE_STEP (rounds down)
            // This step itself should not push it out of MIN/MAX if potentialFeeForBoundCheck was okay
            // and potentialNewFee uses a capped (smaller or equal) adjustment.
            // However, rounding down might still take it below MIN_FEE if it was very close.
            calculatedNewFee = (potentialNewFee / FEE_STEP) * FEE_STEP;

            // Check bounds AGAIN AFTER rounding
            if (calculatedNewFee < MIN_FEE || calculatedNewFee > MAX_FEE) {
                revert InvalidDynamicFee();
            }
            // Even though theoretically calculatedNewFee should never exceed MAX_FEE if potentialFeeForBoundCheck was fine,
            // we check it explicitly for extra safety and to guard against future code changes.
        }

        // Only update if the fee has changed
        if (calculatedNewFee != currentFee) {
            dynamicFees[poolKeyHash] = calculatedNewFee;
            emit DynamicFeeUpdated(poolKeyHash, msg.sender, calculatedNewFee);
        }
    }

    /// @notice Registers a specific pool to use dynamic fees instead of a static configuration.
    /// @dev Only callable by the owner. Sets an initial dynamic fee and an authorized updater address.
    /// Reverts if the pool is already registered or if initial parameters are invalid.
    /// @param key The PoolKey identifying the pool to register.
    /// @param initialFee The initial dynamic fee for the pool. Must be non-zero.
    /// @param updater The address authorized to call `updateFee` for this pool. Must be non-zero.
    function registerDynamicFeePool(PoolKey calldata key, uint24 initialFee, address updater) external onlyOwner {
        bytes32 poolKeyHash = keccak256(abi.encode(key));

        if (initialFee == 0 || updater == address(0)) {
            revert InvalidInitialFeeOrUpdater(poolKeyHash, initialFee, updater);
        }

        // Validate initialFee for dynamic pool registration
        if (initialFee < MIN_FEE || initialFee > MAX_FEE || initialFee % FEE_STEP != 0) {
            revert InvalidInitialFee(initialFee);
        }

        if (feeUpdaters[poolKeyHash] != address(0)) {
            revert PoolAlreadyRegistered(poolKeyHash);
        }

        dynamicFees[poolKeyHash] = initialFee;
        feeUpdaters[poolKeyHash] = updater;
        emit DynamicFeePoolRegistered(poolKeyHash, initialFee, updater);
    }

    /// @notice Changes the authorized address that can update the dynamic fee for a specific pool.
    /// @dev Only callable by the owner. Reverts if the pool is not registered, the new updater is invalid,
    /// or the new updater is the same as the old one.
    /// @param key The PoolKey identifying the pool.
    /// @param newUpdater The new address authorized to update the fee. Must be non-zero and different from the current updater.
    function setFeeUpdater(PoolKey calldata key, address newUpdater) external onlyOwner {
        bytes32 poolKeyHash = keccak256(abi.encode(key));
        address oldUpdater = feeUpdaters[poolKeyHash];

        if (oldUpdater == address(0)) {
            revert PoolNotRegistered(poolKeyHash);
        }
        if (newUpdater == address(0)) {
            revert InvalidNewUpdater(poolKeyHash, newUpdater);
        }
        if (newUpdater == oldUpdater) {
            revert NewUpdaterSameAsOld(poolKeyHash, newUpdater);
        }

        feeUpdaters[poolKeyHash] = newUpdater;
        emit FeeUpdaterSet(poolKeyHash, oldUpdater, newUpdater);
    }

    /// @notice Returns the tick spacing for a given fee tier.
    /// @param fee The fee tier to query.
    /// @return The tick spacing for the given fee tier.
    function getTickSpacing(uint24 fee) external view returns (int24) {
        if (tickSpacings[fee] == 0) {
            revert FeeTierNotSupported(fee);
        }
        // The public mapping automatically creates a getter, but we implement
        // the function explicitly for clarity and adherence to the interface.
        return tickSpacings[fee];
    }
}
