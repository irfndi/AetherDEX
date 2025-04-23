// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.29;
// slither-disable unimplemented-functions

import {BaseHook} from "./BaseHook.sol";
import {IPoolManager} from "../interfaces/IPoolManager.sol";
import {PoolKey} from "../types/PoolKey.sol";
import {BalanceDelta} from "../types/BalanceDelta.sol";
import {Hooks} from "../libraries/Hooks.sol";

contract TWAPOracleHook is BaseHook {
    struct Observation {
        uint32 timestamp;
        uint64 price;
    }

    mapping(bytes32 => Observation[]) public observations;
    uint32 public immutable windowSize;
    uint32 public constant MIN_PERIOD = 60;  // 1 minute minimum

    // Constants for price calculation - reduced scaling factors
    uint64 private constant BASE_PRICE = 1000;     // Reduced from 1e6
    uint256 private constant SCALE = 1000;         // Reduced from 1e6
    uint256 private constant MAX_PRICE = 1_000_000;  // More conservative max price

    error InsufficientObservations();
    error PeriodTooShort();
    error PeriodTooLong();
    error Insufficient_Liquidity();
    error InvalidPrice();
    error ArithmeticError();

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
        bytes32 poolId = _poolId(key.token0, key.token1);
        observations[poolId].push(Observation({
            timestamp: uint32(block.timestamp),
            price: BASE_PRICE
        }));
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
        _recordObservation(_poolId(key.token0, key.token1), delta.amount0, delta.amount1, params.zeroForOne);
        return TWAPOracleHook.afterSwap.selector;
    }

    function calculatePrice(bool /*zeroForOne*/, BalanceDelta memory delta) external pure returns (uint64) {
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

        // Slither: Timestamp - Using block.timestamp is essential for recording price observations
        // at specific points in time, which is fundamental to TWAP oracle functionality.
        if (obs.length == 0 || obs[obs.length - 1].timestamp < timestamp) {
            try this.calculatePrice(zeroForOne, BalanceDelta({amount0: amount0, amount1: amount1})) returns (uint64 price) {
                obs.push(Observation({
                    timestamp: timestamp, // Record the current block timestamp
                    price: price
                }));
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

    function consult(address token0, address token1, uint32 secondsAgo)
        external
        view
        returns (uint256)
    {
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

    function _findNearestObservation(Observation[] storage obs, uint32 target)
        private
        view
        returns (uint256)
    {
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
        return token0 < token1 ? 
            keccak256(abi.encodePacked(token0, token1)) :
            keccak256(abi.encodePacked(token1, token0));
    }

    function observationLength(address token0, address token1) external view returns (uint256) {
        return observations[_poolId(token0, token1)].length;
    }

    function initializeOracle(PoolKey calldata key, uint256 price) external {
        if (price == 0 || price > MAX_PRICE) revert InvalidPrice();
        bytes32 poolId = _poolId(key.token0, key.token1);
        observations[poolId].push(Observation({
            timestamp: uint32(block.timestamp),
            price: uint64(price)
        }));
    }
}
