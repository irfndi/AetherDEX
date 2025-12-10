// SPDX-License-Identifier: GPL-3.0

/*
Created by irfndi (github.com/irfndi) - Apr 2025
Email: join.mantap@gmail.com
*/

pragma solidity ^0.8.31;
// slither-disable unimplemented-functions

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {BaseHook} from "./BaseHook.sol";
import {Hooks} from "../libraries/Hooks.sol";
import {IPoolManager} from "../interfaces/IPoolManager.sol";
import {FeeRegistry} from "../primary/FeeRegistry.sol";
import {PoolKey} from "../../lib/v4-core/src/types/PoolKey.sol";
import {Currency} from "v4-core/types/Currency.sol";
import {BalanceDelta} from "../types/BalanceDelta.sol";

/**
 * @title DynamicFeeHook
 * @notice Hook for dynamic fee adjustment based on pool activity
 * @dev Implements dynamic fee logic using FeeRegistry for cross-chain fee management
 */
contract DynamicFeeHook is
    BaseHook,
    ReentrancyGuard // Inherit ReentrancyGuard
{
    /// @notice Reference to the fee registry contract
    FeeRegistry public immutable feeRegistry;

    // Volatility tracking
    struct VolatilityData {
        uint256 priceSum;
        uint256 priceSquaredSum;
        uint256 sampleCount;
        uint256 lastUpdateTime;
        uint256 lastPrice;
    }

    // Liquidity depth tracking
    struct LiquidityData {
        uint256 totalLiquidity;
        uint256 utilizationRate;
        uint256 lastUpdateTime;
        uint256 averageTradeSize;
        uint256 tradeCount;
    }

    // Market condition tracking
    struct MarketCondition {
        uint256 volatilityScore; // 0-10000 (basis points)
        uint256 liquidityScore; // 0-10000 (basis points)
        uint256 activityScore; // 0-10000 (basis points)
        uint256 lastCalculated;
    }

    // Pool-specific data
    mapping(bytes32 => VolatilityData) public poolVolatility;
    mapping(bytes32 => LiquidityData) public poolLiquidity;
    mapping(bytes32 => MarketCondition) public poolMarketCondition;

    // Time windows for calculations
    uint256 public constant VOLATILITY_WINDOW = 1 hours;
    uint256 public constant LIQUIDITY_WINDOW = 30 minutes;
    uint256 public constant MARKET_CONDITION_WINDOW = 15 minutes;

    // Volatility thresholds
    uint256 public constant LOW_VOLATILITY_THRESHOLD = 100; // 1%
    uint256 public constant HIGH_VOLATILITY_THRESHOLD = 500; // 5%

    // Liquidity thresholds
    uint256 public constant LOW_LIQUIDITY_THRESHOLD = 1000e18;
    uint256 public constant HIGH_LIQUIDITY_THRESHOLD = 100000e18;

    /// @notice Emitted when a pool's fee is updated
    /// @param token0 The first token in the pair
    /// @param token1 The second token in the pair
    /// @param newFee The updated fee value
    /// @param volatilityScore The volatility score used in calculation
    /// @param liquidityScore The liquidity score used in calculation
    event FeeUpdated(
        address indexed token0, address indexed token1, uint24 newFee, uint256 volatilityScore, uint256 liquidityScore
    );

    /// @notice Emitted when market conditions are updated
    event MarketConditionUpdated(
        bytes32 indexed poolId, uint256 volatilityScore, uint256 liquidityScore, uint256 activityScore
    );

    // Enhanced constants for fee calculation
    /// @notice Minimum fee value (0.01%)
    uint24 public constant MIN_FEE = 100;
    /// @notice Maximum fee value (5%)
    uint24 public constant MAX_FEE = 50_000;
    /// @notice Step size for fee adjustments (0.001%)
    uint24 public constant FEE_STEP = 10;
    /// @notice Base fee for normal market conditions (0.3%)
    uint24 public constant BASE_FEE = 3000;
    /// @notice Volume threshold for fee scaling (1000 tokens)
    uint256 private constant VOLUME_THRESHOLD = 1000e18;
    /// @notice Maximum volume multiplier to prevent excessive fees
    uint256 private constant MAX_VOLUME_MULTIPLIER = 5;

    // Fee adjustment factors
    uint256 public constant VOLATILITY_MULTIPLIER = 2000; // 20% max adjustment
    uint256 public constant LIQUIDITY_MULTIPLIER = 1500; // 15% max adjustment
    uint256 public constant ACTIVITY_MULTIPLIER = 1000; // 10% max adjustment

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
     * @dev Slither: Unimplemented-functions - Slither flags this, but the function IS implemented
     *      using the `override(BaseHook)` specifier as required. This appears to be a false positive.
     */
    // slither-disable-next-line unimplemented-functions
    function getHookPermissions() public pure override(BaseHook) returns (Hooks.Permissions memory) {
        // This hook implements beforeSwap and afterSwap
        return Hooks.Permissions({
            beforeInitialize: false,
            afterInitialize: false,
            beforeModifyPosition: false,
            afterModifyPosition: false,
            beforeSwap: true, // True
            afterSwap: true, // True
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
        if (Currency.unwrap(key.currency0) == address(0) || Currency.unwrap(key.currency1) == address(0)) {
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
     * @dev Updates the fee based on volatility, liquidity depth, and market conditions
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
    ) external override nonReentrant returns (bytes4) {
        bytes32 poolId = keccak256(abi.encode(key));

        // Calculate swap volume and price impact
        int256 swapVolume = params.zeroForOne ? delta.amount0 : delta.amount1;
        if (swapVolume != 0) {
            uint256 absSwapVolume = uint256(swapVolume > 0 ? swapVolume : -swapVolume);

            // Update volatility data
            _updateVolatilityData(poolId, key, delta, absSwapVolume);

            // Update liquidity data
            _updateLiquidityData(poolId, absSwapVolume);

            // Calculate and update market conditions
            _updateMarketConditions(poolId);

            // Calculate new fee based on market conditions
            uint24 newFee = _calculateDynamicFee(poolId, absSwapVolume);

            // Update fee in registry
            feeRegistry.updateFee(key, absSwapVolume);

            // Get market condition scores for event
            MarketCondition memory condition = poolMarketCondition[poolId];

            emit FeeUpdated(
                Currency.unwrap(key.currency0),
                Currency.unwrap(key.currency1),
                newFee,
                condition.volatilityScore,
                condition.liquidityScore
            );
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
        // Slither: Divide-before-multiply - The division `(amount + VOLUME_THRESHOLD - 1) / VOLUME_THRESHOLD`
        // calculates ceil(amount / VOLUME_THRESHOLD) using integer arithmetic. This determines the volume tier.
        // The result is then used in the subsequent multiplication to calculate the scaled fee. This order is intentional.
        uint256 volumeMultiplier = (amount + VOLUME_THRESHOLD - 1) / VOLUME_THRESHOLD;

        // Cap the multiplier to prevent excessive fees for large volumes
        if (volumeMultiplier > MAX_VOLUME_MULTIPLIER) {
            volumeMultiplier = MAX_VOLUME_MULTIPLIER;
        }

        // Slither: Divide-before-multiply - This multiplication applies the calculated volumeMultiplier
        // to the base fee. This follows the ceiling division performed earlier.
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

    /**
     * @notice Updates volatility data for a pool
     * @param poolId The pool identifier
     * @param key The pool key
     * @param delta The balance changes from the swap
     * @param volume The swap volume
     */
    function _updateVolatilityData(bytes32 poolId, PoolKey calldata key, BalanceDelta memory delta, uint256 volume)
        private
    {
        VolatilityData storage volatility = poolVolatility[poolId];

        // Calculate price impact as a percentage
        uint256 priceImpact = (volume * 10000) / (volume + 1000000); // Simplified calculation

        // Update rolling average of price impacts
        if (volatility.lastUpdateTime == 0) {
            volatility.priceSum = priceImpact;
            volatility.sampleCount = 1;
        } else {
            // Remove old data if outside time window
            if (block.timestamp > volatility.lastUpdateTime + VOLATILITY_WINDOW) {
                volatility.priceSum = priceImpact;
                volatility.sampleCount = 1;
            } else {
                volatility.priceSum += priceImpact;
                volatility.sampleCount++;

                // Keep only recent data (sliding window)
                if (volatility.sampleCount > 100) {
                    volatility.priceSum = (volatility.priceSum * 90) / 100;
                    volatility.sampleCount = 90;
                }
            }
        }

        volatility.lastUpdateTime = block.timestamp;
        volatility.lastPrice = priceImpact;
    }

    /**
     * @notice Updates liquidity data for a pool
     * @param poolId The pool identifier
     * @param volume The swap volume
     */
    function _updateLiquidityData(bytes32 poolId, uint256 volume) private {
        LiquidityData storage liquidity = poolLiquidity[poolId];

        // Update total volume in the current window
        if (block.timestamp > liquidity.lastUpdateTime + LIQUIDITY_WINDOW) {
            liquidity.averageTradeSize = volume;
            liquidity.tradeCount = 1;
        } else {
            liquidity.averageTradeSize =
                (liquidity.averageTradeSize * liquidity.tradeCount + volume) / (liquidity.tradeCount + 1);
            liquidity.tradeCount++;
        }

        liquidity.lastUpdateTime = block.timestamp;
    }

    /**
     * @notice Updates market conditions based on volatility and liquidity
     * @param poolId The pool identifier
     */
    function _updateMarketConditions(bytes32 poolId) private {
        VolatilityData storage volatility = poolVolatility[poolId];
        LiquidityData storage liquidity = poolLiquidity[poolId];
        MarketCondition storage condition = poolMarketCondition[poolId];

        // Calculate volatility score (0-10000)
        uint256 avgVolatility = volatility.sampleCount > 0 ? volatility.priceSum / volatility.sampleCount : 0;
        if (avgVolatility > HIGH_VOLATILITY_THRESHOLD) {
            condition.volatilityScore = 10000;
        } else if (avgVolatility > LOW_VOLATILITY_THRESHOLD) {
            condition.volatilityScore = 5000 + ((avgVolatility - LOW_VOLATILITY_THRESHOLD) * 5000)
                / (HIGH_VOLATILITY_THRESHOLD - LOW_VOLATILITY_THRESHOLD);
        } else {
            condition.volatilityScore = (avgVolatility * 5000) / LOW_VOLATILITY_THRESHOLD;
        }

        // Calculate liquidity score (0-10000, higher is better liquidity)
        if (liquidity.averageTradeSize > HIGH_LIQUIDITY_THRESHOLD) {
            condition.liquidityScore = 10000;
        } else if (liquidity.averageTradeSize > LOW_LIQUIDITY_THRESHOLD) {
            condition.liquidityScore = 5000 + ((liquidity.averageTradeSize - LOW_LIQUIDITY_THRESHOLD) * 5000)
                / (HIGH_LIQUIDITY_THRESHOLD - LOW_LIQUIDITY_THRESHOLD);
        } else {
            condition.liquidityScore = (liquidity.averageTradeSize * 5000) / LOW_LIQUIDITY_THRESHOLD;
        }

        // Calculate activity score based on trade frequency
        uint256 timeSinceLastUpdate = block.timestamp - liquidity.lastUpdateTime;
        if (timeSinceLastUpdate < MARKET_CONDITION_WINDOW) {
            condition.activityScore = 10000;
        } else {
            condition.activityScore = (MARKET_CONDITION_WINDOW * 10000) / timeSinceLastUpdate;
            if (condition.activityScore > 10000) condition.activityScore = 10000;
        }

        condition.lastCalculated = block.timestamp;

        emit MarketConditionUpdated(
            poolId, condition.volatilityScore, condition.liquidityScore, condition.activityScore
        );
    }

    /**
     * @notice Calculates dynamic fee based on market conditions
     * @param poolId The pool identifier
     * @param volume The current swap volume
     * @return The calculated fee
     */
    function _calculateDynamicFee(bytes32 poolId, uint256 volume) private view returns (uint24) {
        MarketCondition memory condition = poolMarketCondition[poolId];

        // Start with base fee
        uint256 dynamicFee = BASE_FEE;

        // Adjust based on volatility (higher volatility = higher fee)
        uint256 volatilityAdjustment = (condition.volatilityScore * VOLATILITY_MULTIPLIER) / 10000;
        dynamicFee = (dynamicFee * (10000 + volatilityAdjustment)) / 10000;

        // Adjust based on liquidity (higher liquidity = lower fee)
        uint256 liquidityAdjustment = (condition.liquidityScore * LIQUIDITY_MULTIPLIER) / 10000;
        dynamicFee = (dynamicFee * (10000 - liquidityAdjustment)) / 10000;

        // Adjust based on activity (higher activity = slightly higher fee)
        uint256 activityAdjustment = (condition.activityScore * ACTIVITY_MULTIPLIER) / 10000;
        dynamicFee = (dynamicFee * (10000 + activityAdjustment)) / 10000;

        // Ensure fee is within bounds
        if (dynamicFee < MIN_FEE) {
            dynamicFee = MIN_FEE;
        } else if (dynamicFee > MAX_FEE) {
            dynamicFee = MAX_FEE;
        }

        return uint24(dynamicFee);
    }

    /**
     * @notice Gets current market conditions for a pool
     * @param poolId The pool identifier
     * @return condition The current market condition
     */
    function getMarketCondition(bytes32 poolId) external view returns (MarketCondition memory condition) {
        return poolMarketCondition[poolId];
    }

    /**
     * @notice Gets volatility data for a pool
     * @param poolId The pool identifier
     * @return volatility The volatility data
     */
    function getVolatilityData(bytes32 poolId) external view returns (VolatilityData memory volatility) {
        return poolVolatility[poolId];
    }

    /**
     * @notice Gets liquidity data for a pool
     * @param poolId The pool identifier
     * @return liquidity The liquidity data
     */
    function getLiquidityData(bytes32 poolId) external view returns (LiquidityData memory liquidity) {
        return poolLiquidity[poolId];
    }
}
