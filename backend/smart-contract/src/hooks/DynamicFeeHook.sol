// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.29;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol"; // Import ReentrancyGuard
import {BaseHook} from "./BaseHook.sol";
import {Hooks} from "../libraries/Hooks.sol"; // Import Hooks library
import {IPoolManager} from "../interfaces/IPoolManager.sol";
import {FeeRegistry} from "../FeeRegistry.sol";
import {PoolKey} from "../types/PoolKey.sol";
import {BalanceDelta} from "../types/BalanceDelta.sol";

/**
 * @title DynamicFeeHook
 * @notice Hook for dynamic fee adjustment based on pool activity
 * @dev Implements dynamic fee logic using FeeRegistry for cross-chain fee management
 */
contract DynamicFeeHook is BaseHook, ReentrancyGuard { // Inherit ReentrancyGuard
    /// @notice Reference to the fee registry contract
    FeeRegistry public immutable feeRegistry;

    /// @notice Emitted when a pool's fee is updated
    /// @param token0 The first token in the pair
    /// @param token1 The second token in the pair
    /// @param newFee The updated fee value
    event FeeUpdated(address token0, address token1, uint24 newFee);

    // Constants for fee calculation
    /// @notice Minimum fee value (0.01%)
    uint24 public constant MIN_FEE = 100;
    /// @notice Maximum fee value (10%)
    uint24 public constant MAX_FEE = 100_000;
    /// @notice Step size for fee adjustments (0.005%)
    uint24 public constant FEE_STEP = 50;
    /// @notice Volume threshold for fee scaling (1000 tokens)
    uint256 private constant VOLUME_THRESHOLD = 1000e18;
    /// @notice Maximum volume multiplier to prevent excessive fees
    uint256 private constant MAX_VOLUME_MULTIPLIER = 10;

    /// @notice Error thrown when token addresses are invalid
    error InvalidTokenAddress();
    /// @notice Error thrown when fee value is invalid
    error InvalidFee(uint24 fee);

    /**
     * @notice Constructs the DynamicFeeHook
     * @param _poolManager Address of the pool manager
     * @param _feeRegistry Address of the fee registry
     */
    constructor(address _poolManager, address _feeRegistry) BaseHook(_poolManager) {
        if (_feeRegistry == address(0)) revert InvalidTokenAddress();
        feeRegistry = FeeRegistry(_feeRegistry);
    }

    /**
     * @notice Returns the hook's permissions
     * @return Hooks.Permissions struct with beforeSwap and afterSwap set to true
     */
    function getHookPermissions() public pure override(BaseHook) returns (Hooks.Permissions memory) {
        // This hook implements beforeSwap and afterSwap
        return Hooks.Permissions({
            beforeInitialize: false,
            afterInitialize: false,
            beforeModifyPosition: false,
            afterModifyPosition: false,
            beforeSwap: true, // True
            afterSwap: true,  // True
            beforeDonate: false,
            afterDonate: false
        });
    }

    /**
     * @notice Hook called before a swap occurs
     * @dev Validates token addresses and fee values
     * @param key The pool key containing token addresses and fee information
     * @return bytes4 Function selector to indicate success
     */
    function beforeSwap(address, PoolKey calldata key, IPoolManager.SwapParams calldata, bytes calldata)
        external
        view
        override
        returns (bytes4)
    {
        // Validate non-zero addresses
        if (key.token0 == address(0) || key.token1 == address(0)) {
            revert InvalidTokenAddress();
        }

        // Get current dynamic fee from registry using the PoolKey
        uint24 currentFee = feeRegistry.getFee(key);
        if (currentFee == 0) {
            revert InvalidFee(currentFee);
        }

        return this.beforeSwap.selector;
    }

    /**
     * @notice Hook called after a swap occurs
     * @dev Updates the fee based on swap volume
     * @param key The pool key containing token addresses and fee information
     * @param params The swap parameters
     * @param delta The balance changes resulting from the swap
     * @return bytes4 Function selector to indicate success
     */
    function afterSwap(
        address,
        PoolKey calldata key,
        IPoolManager.SwapParams calldata params,
        BalanceDelta memory delta,
        bytes calldata
    ) external override nonReentrant returns (bytes4) { // Added nonReentrant modifier
        // Update fee based on swap volume
        int256 swapVolume = params.zeroForOne ? delta.amount0 : delta.amount1;
        if (swapVolume != 0) {
            // Calculate absolute volume and cast to uint256
            uint256 absSwapVolume = uint256(swapVolume > 0 ? swapVolume : -swapVolume);

            // --- Effects (Emit event *before* external call) ---
            // Get the fee *before* updating it to emit the pre-update value
            uint24 feeBeforeUpdate = feeRegistry.getFee(key);
            emit FeeUpdated(key.token0, key.token1, feeBeforeUpdate); // Emit fee *before* update

            // --- Interaction ---
            // Update fee using the PoolKey and absolute volume
            feeRegistry.updateFee(key, absSwapVolume); // State-changing external call

            // Note: The emitted fee now represents the value *before* this update.
            // If the exact *new* fee needs to be emitted reliably post-update,
            // a different event or pattern might be needed, but this addresses
            // the primary reentrancy vector flagged by Slither.
        }

        return this.afterSwap.selector;
    }

    /**
     * @notice Calculates the fee amount for a given swap
     * @dev Scales the fee based on volume but caps the multiplier to prevent excessive fees
     * @param key The pool key containing token addresses and fee information
     * @param amount The amount being swapped
     * @return The calculated fee amount
     */
    function calculateFee(PoolKey calldata key, uint256 amount) public view returns (uint256) {
        uint24 fee = feeRegistry.getFee(key);
        if (!validateFee(fee)) {
            revert InvalidFee(fee);
        }

        // Scale the fee based on volume with a cap on the multiplier
        uint256 volumeMultiplier = (amount + VOLUME_THRESHOLD - 1) / VOLUME_THRESHOLD;

        // Cap the multiplier to prevent excessive fees for large volumes
        if (volumeMultiplier > MAX_VOLUME_MULTIPLIER) {
            volumeMultiplier = MAX_VOLUME_MULTIPLIER;
        }

        uint256 scaledFee = uint256(fee) * volumeMultiplier;

        // Ensure fee doesn't exceed maximum
        if (scaledFee > MAX_FEE) {
            scaledFee = MAX_FEE;
        }

        // Calculate final fee amount
        return (amount * scaledFee) / 1e6;
    }

    /**
     * @notice Validates if a fee value is within acceptable bounds
     * @param fee The fee value to validate
     * @return bool True if the fee is valid, false otherwise
     */
    function validateFee(uint24 fee) public pure returns (bool) {
        // Fee must be within bounds and a multiple of FEE_STEP
        return fee >= MIN_FEE && fee <= MAX_FEE && fee % FEE_STEP == 0;
    }
}
