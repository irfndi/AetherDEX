// SPDX-License-Identifier: GPL-3.0

/*
Created by irfndi (github.com/irfndi) - Apr 2025
Email: join.mantap@gmail.com
*/

pragma solidity ^0.8.31;
// slither-disable unimplemented-functions

import {BaseHook} from "./BaseHook.sol";
import {IPoolManager} from "../interfaces/IPoolManager.sol";
import {PoolKey} from "../../lib/v4-core/src/types/PoolKey.sol";
import {BalanceDelta} from "../types/BalanceDelta.sol";
import {Hooks} from "../libraries/Hooks.sol";
import {Currency} from "v4-core/types/Currency.sol";

contract TWAPOracleHook is BaseHook {
    struct Observation {
        uint32 timestamp;
        uint64 price;
        uint128 volume; // Volume for VWAP calculation
        uint64 cumulativePrice; // Cumulative price for TWAP
    }

    struct ManipulationProtection {
        uint256 maxPriceDeviation; // Maximum allowed price deviation (basis points)
        uint256 minObservations; // Minimum observations required
        uint256 volumeThreshold; // Minimum volume threshold
        uint32 cooldownPeriod; // Cooldown between updates
    }

    mapping(bytes32 => Observation[]) public observations;
    mapping(bytes32 => ManipulationProtection) public protectionParams;
    mapping(bytes32 => uint32) public lastUpdateTime;
    mapping(bytes32 => uint256) public cumulativeVolume;

    uint32 public immutable windowSize;
    uint32 public constant MIN_PERIOD = 60; // 1 minute minimum
    uint32 public constant MAX_OBSERVATIONS = 1000; // Limit observations array size

    // Constants for price calculation - reduced scaling factors
    uint64 private constant BASE_PRICE = 1000; // Reduced from 1e6
    uint256 private constant SCALE = 1000; // Reduced from 1e6
    uint256 private constant MAX_PRICE = 1_000_000; // More conservative max price
    uint256 private constant DEFAULT_MAX_DEVIATION = 1000; // 10% in basis points
    uint256 private constant DEFAULT_MIN_OBSERVATIONS = 3;
    uint256 private constant DEFAULT_VOLUME_THRESHOLD = 1000;
    uint32 private constant DEFAULT_COOLDOWN = 60; // 1 minute cooldown

    error InsufficientObservations();
    error PeriodTooShort();
    error PeriodTooLong();
    error Insufficient_Liquidity();
    error InvalidPrice();
    error ArithmeticError();
    error PriceManipulationDetected();
    error InsufficientVolume();
    error CooldownActive();
    error ExcessiveDeviation();
    error TooManyObservations();

    // Events
    event PriceUpdated(bytes32 indexed poolId, uint64 price, uint128 volume, uint32 timestamp);
    event ManipulationDetected(bytes32 indexed poolId, uint64 suspiciousPrice, uint64 expectedPrice);
    event ProtectionParamsUpdated(
        bytes32 indexed poolId, uint256 maxDeviation, uint256 minObservations, uint256 volumeThreshold
    );
    event OutlierRejected(bytes32 indexed poolId, uint64 rejectedPrice, string reason);

    constructor(address _poolManager, uint32 _windowSize) BaseHook(_poolManager) {
        windowSize = _windowSize == 0 ? 3600 : _windowSize;
        require(windowSize >= MIN_PERIOD, "Window too short");

        // Validate hook flags match implemented permissions
        // uint160 requiredFlags = Hooks.BEFORE_INITIALIZE_FLAG |
        //                       Hooks.AFTER_INITIALIZE_FLAG |
        //                       Hooks.BEFORE_MODIFY_POSITION_FLAG |
        //                       Hooks.AFTER_MODIFY_POSITION_FLAG |
        //                       Hooks.BEFORE_SWAP_FLAG |
        //                       Hooks.AFTER_SWAP_FLAG;
        // uint160 hookFlags = uint160(address(this)) & 0xFFFF; // Incorrect check based on address
        // require((hookFlags & requiredFlags) == requiredFlags, "Hook flags mismatch"); // Remove this check
    }

    /// @notice Required override from BaseHook
    /// @dev Specifies that this hook uses multiple 'after' callbacks.
    // slither-disable-next-line unimplemented-functions
    function getHookPermissions() public pure override(BaseHook) returns (Hooks.Permissions memory) {
        // This hook implements afterInitialize, afterModifyPosition, afterSwap, afterDonate
        return Hooks.Permissions({
            beforeInitialize: false,
            afterInitialize: true, // True
            beforeModifyPosition: false,
            afterModifyPosition: true, // True
            beforeSwap: false,
            afterSwap: true, // True
            beforeDonate: false,
            afterDonate: true // True
        });
    }

    /// @notice Hook executed after pool initialization
    function afterInitialize(address, PoolKey calldata, uint160, bytes calldata)
        external
        pure
        override
        returns (bytes4)
    {
        return TWAPOracleHook.afterInitialize.selector;
    }

    function beforeInitialize(address, PoolKey calldata key, uint160, bytes calldata)
        external
        override
        returns (bytes4)
    {
        bytes32 poolId = _poolId(Currency.unwrap(key.currency0), Currency.unwrap(key.currency1));

        // Initialize protection parameters with defaults
        protectionParams[poolId] = ManipulationProtection({
            maxPriceDeviation: DEFAULT_MAX_DEVIATION,
            minObservations: DEFAULT_MIN_OBSERVATIONS,
            volumeThreshold: DEFAULT_VOLUME_THRESHOLD,
            cooldownPeriod: DEFAULT_COOLDOWN
        });

        // Initialize first observation
        observations[poolId].push(
            Observation({timestamp: uint32(block.timestamp), price: BASE_PRICE, volume: 0, cumulativePrice: BASE_PRICE})
        );

        lastUpdateTime[poolId] = uint32(block.timestamp);

        return TWAPOracleHook.beforeInitialize.selector;
    }

    function beforeSwap(address, PoolKey calldata, IPoolManager.SwapParams calldata, bytes calldata)
        external
        pure
        override
        returns (bytes4)
    {
        return TWAPOracleHook.beforeSwap.selector;
    }

    function afterSwap(
        address,
        PoolKey calldata key,
        IPoolManager.SwapParams calldata params,
        BalanceDelta memory delta,
        bytes calldata
    ) external override returns (bytes4) {
        _recordObservation(
            _poolId(Currency.unwrap(key.currency0), Currency.unwrap(key.currency1)),
            delta.amount0,
            delta.amount1,
            params.zeroForOne
        );
        return TWAPOracleHook.afterSwap.selector;
    }

    function calculatePrice(
        bool,
        /*zeroForOne*/
        BalanceDelta memory delta
    )
        external
        pure
        returns (uint64)
    {
        // Get absolute values (without scaling down initially)
        uint256 absAmount0 = uint256(delta.amount0 >= 0 ? delta.amount0 : -delta.amount0);
        uint256 absAmount1 = uint256(delta.amount1 >= 0 ? delta.amount1 : -delta.amount1);

        if (absAmount0 == 0 || absAmount1 == 0) revert Insufficient_Liquidity();

        // Calculate price = (amount1 * SCALE) / amount0 to maintain precision
        // Perform multiplication before division
        uint256 price = (absAmount1 * SCALE) / absAmount0;

        // The zeroForOne flag is implicitly handled because price is always token1/token0

        if (price == 0 || price > MAX_PRICE) revert InvalidPrice();
        // Final price is scaled by SCALE
        return uint64(price);
    }

    function _recordObservation(bytes32 poolId, int256 amount0, int256 amount1, bool zeroForOne) internal {
        uint32 timestamp = uint32(block.timestamp);
        Observation[] storage obs = observations[poolId];
        ManipulationProtection memory protection = protectionParams[poolId];

        // Check cooldown period
        if (timestamp < lastUpdateTime[poolId] + protection.cooldownPeriod) {
            return; // Skip update during cooldown
        }

        // Calculate volume
        uint256 absAmount0 = uint256(amount0 >= 0 ? amount0 : -amount0);
        uint256 absAmount1 = uint256(amount1 >= 0 ? amount1 : -amount1);
        uint128 volume = uint128(absAmount0 + absAmount1);

        // Check minimum volume threshold
        if (volume < protection.volumeThreshold) {
            emit OutlierRejected(poolId, 0, "Insufficient volume");
            return;
        }

        // Slither: Timestamp - Using block.timestamp is essential for recording price observations
        // at specific points in time, which is fundamental to TWAP oracle functionality.
        if (obs.length == 0 || obs[obs.length - 1].timestamp < timestamp) {
            try this.calculatePrice(zeroForOne, BalanceDelta({amount0: amount0, amount1: amount1})) returns (
                uint64 price
            ) {
                // Manipulation protection checks
                if (!_validatePrice(poolId, price, volume)) {
                    return; // Price rejected due to manipulation concerns
                }

                // Check array size limit
                if (obs.length >= MAX_OBSERVATIONS) {
                    _cleanObservations(poolId);
                    if (obs.length >= MAX_OBSERVATIONS) {
                        // Remove oldest observation if still at limit
                        for (uint256 i = 0; i < obs.length - 1; i++) {
                            obs[i] = obs[i + 1];
                        }
                        obs.pop();
                    }
                }

                // Calculate cumulative price
                uint64 cumulativePrice = obs.length > 0 ? obs[obs.length - 1].cumulativePrice + price : price;

                obs.push(
                    Observation({timestamp: timestamp, price: price, volume: volume, cumulativePrice: cumulativePrice})
                );

                // Update tracking variables
                lastUpdateTime[poolId] = timestamp;
                cumulativeVolume[poolId] += volume;

                emit PriceUpdated(poolId, price, volume, timestamp);
            } catch {
                // If price calculation fails, don't update observation but still return success
                return;
            }

            _cleanObservations(poolId);
        }
    }

    function _cleanObservations(bytes32 poolId) internal {
        Observation[] storage obs = observations[poolId];

        // Prevent underflow when block.timestamp is small
        // Slither: Timestamp - Using block.timestamp is necessary here to determine the cutoff
        // point for cleaning old observations based on the defined windowSize.
        if (block.timestamp < windowSize) {
            // If not enough time has passed, no observations need cleaning yet.
            return;
        }
        uint256 cutoff = block.timestamp - windowSize;

        uint256 i = 0;
        // Slither: Timestamp - Comparison with timestamp is needed to identify and remove
        // observations older than the TWAP window.
        while (i < obs.length && obs[i].timestamp < cutoff) {
            i++;
        }

        if (i > 0) {
            uint256 j = 0;
            while (i < obs.length) {
                obs[j] = obs[i];
                i++;
                j++;
            }
            while (obs.length > j) {
                obs.pop();
            }
        }
    }

    function consult(address token0, address token1, uint32 secondsAgo) external view returns (uint256) {
        if (secondsAgo < MIN_PERIOD) revert PeriodTooShort();
        if (secondsAgo > windowSize) revert PeriodTooLong();

        bytes32 poolId = _poolId(token0, token1);
        Observation[] storage obs = observations[poolId];

        if (obs.length == 0) revert InsufficientObservations();

        uint32 target = uint32(block.timestamp - secondsAgo);
        uint256 index = _findNearestObservation(obs, target);

        if (token0 < token1) {
            return obs[index].price;
        } else {
            uint256 price = obs[index].price;
            if (price == 0) revert InvalidPrice();
            return (SCALE * SCALE) / price;
        }
    }

    function _findNearestObservation(Observation[] storage obs, uint32 target) private view returns (uint256) {
        uint256 left = 0;
        uint256 right = obs.length - 1;

        while (left < right) {
            uint256 mid = (left + right + 1) / 2;
            // Slither: Timestamp - Comparison with observation timestamps is essential for the
            // binary search to find the observation closest to the target time (`target` is derived from block.timestamp).
            if (obs[mid].timestamp <= target) {
                left = mid;
            } else {
                right = mid - 1;
            }
        }

        return left;
    }

    function _poolId(address token0, address token1) internal pure returns (bytes32) {
        return
            token0 < token1 ? keccak256(abi.encodePacked(token0, token1)) : keccak256(abi.encodePacked(token1, token0));
    }

    function observationLength(address token0, address token1) external view returns (uint256) {
        return observations[_poolId(token0, token1)].length;
    }

    function initializeOracle(PoolKey calldata key, uint256 price) external {
        if (price == 0 || price > MAX_PRICE) revert InvalidPrice();
        bytes32 poolId = _poolId(Currency.unwrap(key.currency0), Currency.unwrap(key.currency1));
        observations[poolId].push(
            Observation({
                timestamp: uint32(block.timestamp), price: uint64(price), volume: 0, cumulativePrice: uint64(price)
            })
        );
    }

    /**
     * @notice Validates price against manipulation protection parameters
     * @param poolId The pool identifier
     * @param price The price to validate
     * @param volume The volume associated with this price
     * @return bool True if price is valid
     */
    function _validatePrice(bytes32 poolId, uint64 price, uint128 volume) internal returns (bool) {
        Observation[] storage obs = observations[poolId];
        ManipulationProtection memory protection = protectionParams[poolId];

        // Need minimum observations for validation
        if (obs.length < protection.minObservations) {
            return true; // Allow during bootstrap phase
        }

        // Calculate recent average price (last few observations)
        uint256 recentAvg = _calculateRecentAverage(poolId, 5); // Last 5 observations

        // Check for excessive deviation
        uint256 deviation =
            price > recentAvg ? ((price - recentAvg) * 10000) / recentAvg : ((recentAvg - price) * 10000) / recentAvg;

        if (deviation > protection.maxPriceDeviation) {
            emit ManipulationDetected(poolId, price, uint64(recentAvg));
            emit OutlierRejected(poolId, price, "Excessive price deviation");
            return false;
        }

        // Volume-weighted validation
        if (!_validateVolumeWeightedPrice(poolId, price, volume)) {
            emit OutlierRejected(poolId, price, "Volume-weighted validation failed");
            return false;
        }

        return true;
    }

    /**
     * @notice Calculates recent average price from last N observations
     * @param poolId The pool identifier
     * @param count Number of recent observations to consider
     * @return Average price
     */
    function _calculateRecentAverage(bytes32 poolId, uint256 count) internal view returns (uint256) {
        Observation[] storage obs = observations[poolId];
        if (obs.length == 0) return BASE_PRICE;

        uint256 start = obs.length > count ? obs.length - count : 0;
        uint256 sum = 0;
        uint256 validCount = 0;

        for (uint256 i = start; i < obs.length; i++) {
            sum += obs[i].price;
            validCount++;
        }

        return validCount > 0 ? sum / validCount : BASE_PRICE;
    }

    /**
     * @notice Validates price using volume-weighted approach
     * @param poolId The pool identifier
     * @param price The price to validate
     * @param volume The volume for this price
     * @return bool True if validation passes
     */
    function _validateVolumeWeightedPrice(bytes32 poolId, uint64 price, uint128 volume) internal view returns (bool) {
        Observation[] storage obs = observations[poolId];
        if (obs.length < 3) return true; // Not enough data

        // Calculate volume-weighted average price (VWAP) for recent observations
        uint256 totalVolumeWeightedPrice = 0;
        uint256 totalVolume = 0;
        uint256 start = obs.length > 10 ? obs.length - 10 : 0;

        for (uint256 i = start; i < obs.length; i++) {
            if (obs[i].volume > 0) {
                totalVolumeWeightedPrice += uint256(obs[i].price) * uint256(obs[i].volume);
                totalVolume += obs[i].volume;
            }
        }

        if (totalVolume == 0) return true; // No volume data available

        uint256 vwap = totalVolumeWeightedPrice / totalVolume;
        uint256 deviation = price > vwap ? ((price - vwap) * 10000) / vwap : ((vwap - price) * 10000) / vwap;

        // Allow higher deviation for low volume trades
        uint256 maxDeviation = volume < 10000 ? 2000 : 1000; // 20% vs 10%

        return deviation <= maxDeviation;
    }

    /**
     * @notice Gets TWAP for a specific period
     * @param poolId The pool identifier
     * @param secondsAgo Seconds ago to calculate TWAP from
     * @return TWAP price
     */
    function getTWAP(bytes32 poolId, uint32 secondsAgo) external view returns (uint256) {
        Observation[] storage obs = observations[poolId];
        if (obs.length < 2) revert InsufficientObservations();

        uint32 targetTime = uint32(block.timestamp - secondsAgo);
        uint256 startIndex = _findNearestObservation(obs, targetTime);

        if (startIndex >= obs.length - 1) {
            return obs[obs.length - 1].price;
        }

        // Calculate time-weighted average
        uint256 totalWeightedPrice = 0;
        uint256 totalTime = 0;

        for (uint256 i = startIndex; i < obs.length - 1; i++) {
            uint256 timeDelta = obs[i + 1].timestamp - obs[i].timestamp;
            totalWeightedPrice += obs[i].price * timeDelta;
            totalTime += timeDelta;
        }

        return totalTime > 0 ? totalWeightedPrice / totalTime : obs[obs.length - 1].price;
    }

    /**
     * @notice Gets Volume-Weighted Average Price (VWAP)
     * @param poolId The pool identifier
     * @param secondsAgo Seconds ago to calculate VWAP from
     * @return VWAP price
     */
    function getVWAP(bytes32 poolId, uint32 secondsAgo) external view returns (uint256) {
        Observation[] storage obs = observations[poolId];
        if (obs.length == 0) revert InsufficientObservations();

        uint32 targetTime = uint32(block.timestamp - secondsAgo);
        uint256 startIndex = _findNearestObservation(obs, targetTime);

        uint256 totalVolumeWeightedPrice = 0;
        uint256 totalVolume = 0;

        for (uint256 i = startIndex; i < obs.length; i++) {
            if (obs[i].volume > 0) {
                totalVolumeWeightedPrice += uint256(obs[i].price) * uint256(obs[i].volume);
                totalVolume += obs[i].volume;
            }
        }

        return totalVolume > 0 ? totalVolumeWeightedPrice / totalVolume : 0;
    }

    /**
     * @notice Updates protection parameters for a pool
     * @param poolId The pool identifier
     * @param maxDeviation Maximum allowed price deviation (basis points)
     * @param minObservations Minimum observations required
     * @param volumeThreshold Minimum volume threshold
     * @param cooldownPeriod Cooldown between updates
     */
    function updateProtectionParams(
        bytes32 poolId,
        uint256 maxDeviation,
        uint256 minObservations,
        uint256 volumeThreshold,
        uint32 cooldownPeriod
    ) external {
        // In a real implementation, this should have access control
        protectionParams[poolId] = ManipulationProtection({
            maxPriceDeviation: maxDeviation,
            minObservations: minObservations,
            volumeThreshold: volumeThreshold,
            cooldownPeriod: cooldownPeriod
        });

        emit ProtectionParamsUpdated(poolId, maxDeviation, minObservations, volumeThreshold);
    }

    /**
     * @notice Gets protection parameters for a pool
     * @param poolId The pool identifier
     * @return Protection parameters
     */
    function getProtectionParams(bytes32 poolId) external view returns (ManipulationProtection memory) {
        return protectionParams[poolId];
    }

    /**
     * @notice Gets the latest observation for a pool
     * @param poolId The pool identifier
     * @return Latest observation
     */
    function getLatestObservation(bytes32 poolId) external view returns (Observation memory) {
        Observation[] storage obs = observations[poolId];
        require(obs.length > 0, "No observations");
        return obs[obs.length - 1];
    }
}
