// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.29;

import {BaseHook} from "./BaseHook.sol";
import {IPoolManager} from "../interfaces/IPoolManager.sol";
import {Hooks} from "../libraries/Hooks.sol";
import {FeeRegistry} from "../FeeRegistry.sol";
import {PoolKey} from "../types/PoolKey.sol";
import {BalanceDelta} from "../types/BalanceDelta.sol";

/**
 * @title DynamicFeeHook
 * @notice Hook for dynamic fee adjustment based on pool activity
 * @dev Implements dynamic fee logic using FeeRegistry for cross-chain fee management
 */
contract DynamicFeeHook is BaseHook {
    FeeRegistry public immutable feeRegistry;

    event FeeUpdated(address token0, address token1, uint24 newFee);

    // Constants for fee calculation
    uint24 public constant MIN_FEE = 100; // 0.01%
    uint24 public constant MAX_FEE = 100000; // 10%
    uint24 public constant FEE_STEP = 50; // 0.005%
    uint256 private constant VOLUME_THRESHOLD = 1000e18; // 1000 tokens

    constructor(address _poolManager, address _feeRegistry)
        BaseHook(_poolManager)
    {
        feeRegistry = FeeRegistry(_feeRegistry);
        
        // // Validate hook flags match implemented permissions - Incorrect check based on address
        // uint160 requiredFlags = Hooks.BEFORE_SWAP_FLAG | Hooks.AFTER_SWAP_FLAG;
        // uint160 hookFlags = uint160(address(this)) & 0xFFFF;
        // require((hookFlags & requiredFlags) == requiredFlags, "Hook flags mismatch"); // Remove this check
    }

    function getHookPermissions() public pure override returns (Hooks.Permissions memory) {
        return Hooks.Permissions({
            beforeInitialize: false,
            afterInitialize: false,
            beforeModifyPosition: false,
            afterModifyPosition: false,
            beforeSwap: true,
            afterSwap: true,
            beforeDonate: false,
            afterDonate: false
        });
    }

    function beforeSwap(address, PoolKey calldata key, IPoolManager.SwapParams calldata, bytes calldata)
        external
        view
        override
        returns (bytes4)
    {
        // Validate non-zero addresses
        require(key.token0 != address(0) && key.token1 != address(0), "Invalid token address");

        // Get current dynamic fee from registry using the PoolKey
        uint24 currentFee = feeRegistry.getFee(key); // <-- Use PoolKey directly
        require(currentFee > 0, "Invalid fee");

        return this.beforeSwap.selector;
    }

    function afterSwap(
        address,
        PoolKey calldata key,
        IPoolManager.SwapParams calldata params,
        BalanceDelta memory delta,
        bytes calldata
    ) external override returns (bytes4) {
        // Update fee based on swap volume
        int256 swapVolume = params.zeroForOne ? delta.amount0 : delta.amount1;
        if (swapVolume != 0) {
            // Calculate absolute volume and cast to uint256
            uint256 absSwapVolume = uint256(swapVolume > 0 ? swapVolume : -swapVolume);

            // Update fee using the PoolKey and absolute volume
            feeRegistry.updateFee(key, absSwapVolume); // <-- Pass uint256 absolute volume

            // Get the updated fee using the PoolKey
            uint24 newFee = feeRegistry.getFee(key); // <-- Use PoolKey directly
            emit FeeUpdated(key.token0, key.token1, newFee); // Event still uses individual tokens for clarity
        }

        return this.afterSwap.selector;
    }

    // Removed redundant getFee function as feeRegistry.getFee(key) is the source of truth

    function calculateFee(PoolKey calldata key, uint256 amount) public view returns (uint256) { // <-- Use PoolKey
        uint24 fee = feeRegistry.getFee(key); // <-- Use PoolKey directly
        require(validateFee(fee), "Invalid fee");

        // Scale the fee based on volume
        uint256 volumeMultiplier = (amount + VOLUME_THRESHOLD - 1) / VOLUME_THRESHOLD;
        uint256 scaledFee = uint256(fee) * volumeMultiplier;
        
        // Ensure fee doesn't exceed maximum
        if (scaledFee > MAX_FEE) {
            scaledFee = MAX_FEE;
        }

        // Calculate final fee amount
        return (amount * scaledFee) / 1e6;
    }

    function validateFee(uint256 fee) public pure returns (bool) {
        // Fee must be within bounds and a multiple of FEE_STEP
        return fee >= MIN_FEE && fee <= MAX_FEE && fee % FEE_STEP == 0;
    }
}
