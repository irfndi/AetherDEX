// SPDX-License-Identifier: MIT
pragma solidity ^0.8.31;

import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {BalanceDelta, BalanceDeltaLibrary} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {BeforeSwapDelta, BeforeSwapDeltaLibrary} from "@uniswap/v4-core/src/types/BeforeSwapDelta.sol";
import {ModifyLiquidityParams, SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {FullMath} from "@uniswap/v4-core/src/libraries/FullMath.sol";
import {FixedPoint96} from "@uniswap/v4-core/src/libraries/FixedPoint96.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Errors} from "../lib/Errors.sol";

/// @title AetherHook
/// @notice Custom Uniswap V4 hook for AetherDEX
/// @dev Captures protocol fee on every swap + records a Uniswap-v3-style TWAP oracle.
///      Hook permissions: BEFORE_SWAP_FLAG | AFTER_SWAP_FLAG
///      The hook address MUST have bits 6 and 7 set for these flags.
///
///      TWAP design (Plan §9 G2.5): each observation stores the pool's terminal POOL
///      STATE (the current tick read from the PoolManager's slot0 after the swap), NOT
///      the swap's volume-dependent execution price. Observations accumulate a
///      time-weighted cumulative tick — `tickCumulative += lastTick * elapsedSeconds`
///      (Uniswap v3 `Oracle.observe()` style) — so the time-weighted average tick over
///      any window [t0, t1] is `(tickCumulative(t1) - tickCumulative(t0)) / (t1 - t0)`
///      and is correct regardless of trade size. This is the keeper-safe substrate the
///      V4-native TP/SL + auto-recenter (Phase 2) will verify triggers against.
contract AetherHook is IHooks, Ownable {
    using StateLibrary for IPoolManager;
    using PoolIdLibrary for PoolKey;

    /// @notice The Uniswap V4 PoolManager
    IPoolManager public immutable poolManager;

    /// @notice The AetherDEX treasury (receives protocol fees)
    address public treasury;

    /// @notice Protocol fee in basis points (e.g. 10 = 0.10%)
    uint24 public protocolFeeBps;

    /// @notice Maximum protocol fee (1000 bps = 10%)
    uint24 public constant MAX_PROTOCOL_FEE_BPS = 1000;

    /// @notice TWAP observation for a pool — the pool's terminal SPOT STATE at sample time
    /// @dev Packed into a single storage slot: 32 + 56 + 24 + 8 = 120 bits.
    ///      `tickCumulative` stores the running sum of `tick * elapsed_time` (two's-complement
    ///      wraparound, exactly like Uniswap v3's int56 accumulator): the time-weighted average
    ///      tick over any window is the cumulative difference divided by elapsed seconds.
    struct Observation {
        /// @dev block.timestamp when the observation was recorded
        uint32 timestamp;
        /// @dev running sum of (each observed tick * seconds it was the terminal spot tick)
        int56 tickCumulative;
        /// @dev the pool's terminal tick (from PoolManager slot0) at `timestamp`
        int24 tick;
        /// @dev whether this slot holds a real observation
        bool initialized;
    }

    // ---- TWAP storage ----
    /// @dev Maximum observations retained per pool (cardinality of the circular buffer)
    uint16 public constant OBSERVATION_BUFFER_SIZE = 1024;

    /// @dev internal poolId => ring buffer of observations (size 1024)
    mapping(bytes32 => Observation[1024]) internal _observations;
    /// @dev internal poolId => index of the most recently written observation
    mapping(bytes32 => uint16) public observationIndex;
    /// @dev internal poolId => number of initialized observations (capped at 1024)
    mapping(bytes32 => uint16) public observationCount;

    // ---- Fee accrual storage ----
    /// @dev poolId => accumulated protocol fees in token0
    mapping(bytes32 => uint256) public accruedFees0;
    /// @dev poolId => accumulated protocol fees in token1
    mapping(bytes32 => uint256) public accruedFees1;

    // ---- Events ----
    event ProtocolFeeUpdated(uint24 oldFee, uint24 newFee);
    event TreasuryUpdated(address oldTreasury, address newTreasury);
    event FeesWithdrawn(bytes32 indexed poolId, address indexed to, uint256 amount0, uint256 amount1);
    event ObservationRecorded(bytes32 indexed poolId, uint32 timestamp, int56 tickCumulative, int24 tick);

    // ---- Errors ----
    error FeeTooHigh();

    /// @param _poolManager The Uniswap V4 PoolManager
    /// @param _treasury The address that receives protocol fees
    /// @param _protocolFeeBps Initial protocol fee in basis points
    /// @param _initialOwner The initial owner of the hook
    constructor(IPoolManager _poolManager, address _treasury, uint24 _protocolFeeBps, address _initialOwner)
        Ownable(_initialOwner)
    {
        if (_treasury == address(0)) revert Errors.ZeroAddress();
        if (_protocolFeeBps > MAX_PROTOCOL_FEE_BPS) revert FeeTooHigh();
        poolManager = _poolManager;

        // Validate hook address has correct permission flags
        Hooks.validateHookPermissions(
            this,
            Hooks.Permissions({
                beforeInitialize: false,
                afterInitialize: false,
                beforeAddLiquidity: false,
                afterAddLiquidity: false,
                beforeRemoveLiquidity: false,
                afterRemoveLiquidity: false,
                beforeSwap: true,
                afterSwap: true,
                beforeDonate: false,
                afterDonate: false,
                beforeSwapReturnDelta: false,
                afterSwapReturnDelta: false,
                afterAddLiquidityReturnDelta: false,
                afterRemoveLiquidityReturnDelta: false
            })
        );

        treasury = _treasury;
        protocolFeeBps = _protocolFeeBps;
    }

    // ---- Owner-only admin functions ----

    /// @notice Set the protocol fee (only owner)
    /// @param _newFeeBps New fee in basis points (max 1000 = 10%)
    function setProtocolFee(uint24 _newFeeBps) external onlyOwner {
        if (_newFeeBps > MAX_PROTOCOL_FEE_BPS) revert FeeTooHigh();
        emit ProtocolFeeUpdated(protocolFeeBps, _newFeeBps);
        protocolFeeBps = _newFeeBps;
    }

    /// @notice Set the treasury address (only owner)
    /// @param _newTreasury New treasury address
    function setTreasury(address _newTreasury) external onlyOwner {
        if (_newTreasury == address(0)) revert Errors.ZeroAddress();
        emit TreasuryUpdated(treasury, _newTreasury);
        treasury = _newTreasury;
    }

    /// @notice Withdraw accrued protocol fees for a pool (only owner)
    /// @param poolId The pool to withdraw fees from
    /// @dev In production, this transfers tokens via poolManager.take().
    ///      Currently emits event only — actual transfer requires unlock context.
    function withdrawFees(bytes32 poolId) external onlyOwner {
        uint256 amount0 = accruedFees0[poolId];
        uint256 amount1 = accruedFees1[poolId];
        if (amount0 == 0 && amount1 == 0) revert Errors.ZeroAmount();

        // CEI: zero accounting first.
        accruedFees0[poolId] = 0;
        accruedFees1[poolId] = 0;

        // NOTE: Actual token transfer must happen inside the poolManager.unlock() callback
        // so the hook can call poolManager.take() to pull tokens from the pool manager's
        // transient balance. This function only resets the accounting — the owner must
        // call withdrawFees in a callback that transfers the actual tokens. Emit the
        // event for off-chain indexers; the actual token movement happens in the callback.
        emit FeesWithdrawn(poolId, treasury, amount0, amount1);
    }

    // ---- IHooks implementation ----

    /// @inheritdoc IHooks
    function beforeInitialize(address, PoolKey calldata, uint160) external pure returns (bytes4) {
        revert("not implemented");
    }

    /// @inheritdoc IHooks
    function afterInitialize(address, PoolKey calldata, uint160, int24) external pure returns (bytes4) {
        revert("not implemented");
    }

    /// @inheritdoc IHooks
    function beforeAddLiquidity(address, PoolKey calldata, ModifyLiquidityParams calldata, bytes calldata)
        external
        pure
        returns (bytes4)
    {
        revert("not implemented");
    }

    /// @inheritdoc IHooks
    function afterAddLiquidity(
        address,
        PoolKey calldata,
        ModifyLiquidityParams calldata,
        BalanceDelta,
        BalanceDelta,
        bytes calldata
    ) external pure returns (bytes4, BalanceDelta) {
        revert("not implemented");
    }

    /// @inheritdoc IHooks
    function beforeRemoveLiquidity(address, PoolKey calldata, ModifyLiquidityParams calldata, bytes calldata)
        external
        pure
        returns (bytes4)
    {
        revert("not implemented");
    }

    /// @inheritdoc IHooks
    function afterRemoveLiquidity(
        address,
        PoolKey calldata,
        ModifyLiquidityParams calldata,
        BalanceDelta,
        BalanceDelta,
        bytes calldata
    ) external pure returns (bytes4, BalanceDelta) {
        revert("not implemented");
    }

    /// @inheritdoc IHooks
    function beforeSwap(address, PoolKey calldata, SwapParams calldata, bytes calldata)
        external
        onlyPoolManager
        returns (bytes4, BeforeSwapDelta, uint24)
    {
        // No-op: we capture fees in afterSwap
        return (this.beforeSwap.selector, BeforeSwapDeltaLibrary.ZERO_DELTA, 0);
    }

    /// @inheritdoc IHooks
    function afterSwap(address, PoolKey calldata key, SwapParams calldata params, BalanceDelta delta, bytes calldata)
        external
        onlyPoolManager
        returns (bytes4, int128)
    {
        bytes32 poolId = _poolId(key);

        // Determine swap direction from delta
        int128 amount0 = delta.amount0();
        int128 amount1 = delta.amount1();
        uint256 amountIn;
        uint256 amountOut;

        if (params.zeroForOne) {
            // Swapping token0 for token1: user pays token0 (positive delta0), receives token1 (negative delta1)
            amountIn = amount0 > 0 ? uint256(int256(amount0)) : 0;
            amountOut = amount1 < 0 ? uint256(int256(-amount1)) : 0;
        } else {
            // Swapping token1 for token0: user pays token1 (positive delta1), receives token0 (negative delta0)
            amountIn = amount1 > 0 ? uint256(int256(amount1)) : 0;
            amountOut = amount0 < 0 ? uint256(int256(-amount0)) : 0;
        }

        // Capture protocol fee
        if (protocolFeeBps > 0 && amountIn > 0) {
            uint256 fee = (amountIn * uint256(protocolFeeBps)) / 10_000;
            if (params.zeroForOne) {
                accruedFees0[poolId] += fee;
            } else {
                accruedFees1[poolId] += fee;
            }
        }

        // Record TWAP observation: sample the pool's TERMINAL SPOT TICK (slot0) after the
        // swap — a pool-state price that is independent of the swap's size — rather than
        // the volume-dependent execution price implied by amountIn/amountOut.
        if (amountIn > 0 && amountOut > 0) {
            (, int24 tick,,) = poolManager.getSlot0(key.toId());
            _recordObservation(poolId, tick);
        }

        // Return 0 delta — the hook does not alter the swap output
        return (this.afterSwap.selector, 0);
    }

    /// @inheritdoc IHooks
    function beforeDonate(address, PoolKey calldata, uint256, uint256, bytes calldata) external pure returns (bytes4) {
        revert("not implemented");
    }

    /// @inheritdoc IHooks
    function afterDonate(address, PoolKey calldata, uint256, uint256, bytes calldata) external pure returns (bytes4) {
        revert("not implemented");
    }

    // ---- TWAP read functions (Uniswap v3 `observe()` style) ----

    /// @notice Read the tick cumulatives at several points in the past (v3-style oracle query)
    /// @param poolId The pool to query
    /// @param secondsAgos Seconds in the past to query (0 = now). Targets older than the
    ///        retained buffer revert with {Errors.InsufficientElapsedTime}.
    /// @return tickCumulatives The cumulative tick at each requested target time. Targets
    ///         between stored observations are linearly interpolated; targets newer than the
    ///         latest observation are extrapolated with the latest terminal tick.
    function observe(bytes32 poolId, uint32[] calldata secondsAgos)
        external
        view
        returns (int56[] memory tickCumulatives)
    {
        uint32 time = uint32(block.timestamp);
        tickCumulatives = new int56[](secondsAgos.length);
        for (uint256 i = 0; i < secondsAgos.length; i++) {
            tickCumulatives[i] = _observeCumulative(poolId, time - secondsAgos[i]);
        }
    }

    /// @notice Time-weighted average tick over the last `secondsAgo` seconds
    /// @param poolId The pool to query
    /// @param secondsAgo Length of the averaging window in seconds (must be > 0)
    /// @return avgTick The time-weighted average terminal tick (rounded toward negative
    ///         infinity — floor division — so negative, non-divisible deltas round DOWN).
    /// @dev Requires at least two observations, and the window start must lie within the
    ///      retained buffer. Reverts with {Errors.InsufficientObservations} or
    ///      {Errors.InsufficientElapsedTime} otherwise.
    function getTwapTick(bytes32 poolId, uint32 secondsAgo) public view returns (int24 avgTick) {
        if (secondsAgo == 0) revert Errors.InsufficientElapsedTime();
        if (observationCount[poolId] < 2) revert Errors.InsufficientObservations();

        uint32 time = uint32(block.timestamp);
        int56 cumulativeNow = _observeCumulative(poolId, time);
        int56 cumulativeThen = _observeCumulative(poolId, time - secondsAgo);

        // Two's-complement subtraction (overflow-safe for deltas within int56 range),
        // mirroring Uniswap v3's oracle tick averaging.
        unchecked {
            int56 numerator = cumulativeNow - cumulativeThen;
            int56 denominator = int56(uint56(secondsAgo));
            int56 quotient = numerator / denominator;
            // Solidity rounds integer division toward zero; for a negative, non-divisible
            // delta that truncates the average UP by one tick (e.g. -70000/90 = -777 instead
            // of the floor -778), biasing the TWAP price upward and risking spurious TP/SL
            // crossings. Decrement the quotient on a negative remainder to floor it.
            if (numerator < 0 && numerator % denominator != 0) quotient -= int56(1);
            avgTick = int24(quotient);
        }
    }

    /// @notice Time-weighted average price (token1 per token0) over the last `secondsAgo` seconds
    /// @param poolId The pool to query
    /// @param secondsAgo Length of the averaging window in seconds
    /// @return priceX18 The time-weighted average price, scaled by 1e18
    function getCurrentTwap(bytes32 poolId, uint32 secondsAgo) external view returns (uint256 priceX18) {
        return _tickToPriceX18(getTwapTick(poolId, secondsAgo), false);
    }

    /// @notice Time-weighted average price in the reverse direction (token0 per token1)
    /// @param poolId The pool to query
    /// @param secondsAgo Length of the averaging window in seconds
    /// @return priceX18 The reciprocal of the time-weighted average price, scaled by 1e18
    function getCurrentTwapInverted(bytes32 poolId, uint32 secondsAgo) external view returns (uint256 priceX18) {
        return _tickToPriceX18(getTwapTick(poolId, secondsAgo), true);
    }

    /// @notice Get the latest observation for a pool
    /// @param poolId The pool to query
    /// @return timestamp The observation timestamp
    /// @return tickCumulative The cumulative tick at `timestamp`
    /// @return tick The terminal spot tick recorded at `timestamp`
    function getLatestObservation(bytes32 poolId)
        external
        view
        returns (uint32 timestamp, int56 tickCumulative, int24 tick)
    {
        uint16 count = observationCount[poolId];
        if (count == 0) return (0, 0, 0);

        uint16 idx = observationIndex[poolId];
        Observation memory obs = _observations[poolId][idx];
        return (obs.timestamp, obs.tickCumulative, obs.tick);
    }

    /// @notice Read a stored observation by its raw buffer slot
    /// @param poolId The pool to query
    /// @param bufferIndex Ring-buffer slot in [0, 1024)
    function observationAt(bytes32 poolId, uint16 bufferIndex)
        external
        view
        returns (uint32 timestamp, int56 tickCumulative, int24 tick, bool initialized)
    {
        if (bufferIndex >= OBSERVATION_BUFFER_SIZE) revert Errors.PoolIndexOutOfBounds();
        Observation memory obs = _observations[poolId][bufferIndex];
        return (obs.timestamp, obs.tickCumulative, obs.tick, obs.initialized);
    }

    // ---- Internal functions ----

    /// @notice Compute pool ID from PoolKey
    function _poolId(PoolKey memory key) internal pure returns (bytes32) {
        return keccak256(abi.encode(key));
    }

    /// @notice Record a time-weighted tick observation for a pool (Uniswap v3 Oracle.write style)
    /// @param poolId The pool to record for
    /// @param tick The pool's terminal spot tick at `block.timestamp`
    /// @dev Accumulates `tickCumulative += lastTick * elapsedSeconds`. Same-timestamp samples
    ///      are folded in place (no zero-elapsed observation is ever stored, so no read path
    ///      can divide by a zero delta). When the 1024-slot ring is full, the oldest slot is
    ///      overwritten.
    function _recordObservation(bytes32 poolId, int24 tick) internal {
        uint32 time = uint32(block.timestamp);
        uint16 count = observationCount[poolId];

        // First observation for this pool: initialize slot 0 with zero cumulative.
        if (count == 0) {
            _observations[poolId][0] = Observation({timestamp: time, tickCumulative: 0, tick: tick, initialized: true});
            observationIndex[poolId] = 0;
            observationCount[poolId] = 1;
            emit ObservationRecorded(poolId, time, 0, tick);
            return;
        }

        uint16 index = observationIndex[poolId];
        Observation storage last = _observations[poolId][index];

        // Same block timestamp as the newest observation: accumulate nothing (zero elapsed
        // delta would break time-weighting) and refresh the terminal tick in place.
        if (last.timestamp == time) {
            last.tick = tick;
            emit ObservationRecorded(poolId, time, last.tickCumulative, tick);
            return;
        }

        // New cumulative: the previously recorded tick held for (time - last.timestamp) seconds.
        int56 cumulative;
        unchecked {
            cumulative = last.tickCumulative + int56(int256(last.tick)) * int56(uint56(time - last.timestamp));
        }

        // Advance the circular buffer (overwrite the oldest slot once full).
        uint16 nextIndex = (index + 1) % OBSERVATION_BUFFER_SIZE;
        _observations[poolId][nextIndex] =
            Observation({timestamp: time, tickCumulative: cumulative, tick: tick, initialized: true});
        observationIndex[poolId] = nextIndex;
        // Ring is saturated at 1024: the overwritten oldest slot is simply recycled.
        if (count < OBSERVATION_BUFFER_SIZE) observationCount[poolId] = count + 1;

        emit ObservationRecorded(poolId, time, cumulative, tick);
    }

    /// @notice Cumulative tick at an arbitrary target timestamp (interpolated / extrapolated)
    /// @param poolId The pool to query
    /// @param target The unix timestamp to resolve the cumulative tick for
    /// @return cumulative The (interpolated) tickCumulative at `target`
    function _observeCumulative(bytes32 poolId, uint32 target) internal view returns (int56 cumulative) {
        uint16 count = observationCount[poolId];
        if (count == 0) revert Errors.InsufficientObservations();

        uint16 newest = observationIndex[poolId];
        Observation storage last = _observations[poolId][newest];

        // At or after the newest observation: extrapolate using the latest terminal tick.
        if (target >= last.timestamp) {
            unchecked {
                return last.tickCumulative + int56(int256(last.tick)) * int56(uint56(target - last.timestamp));
            }
        }

        uint16 oldest = _oldestIndex(count, newest);
        Observation storage first = _observations[poolId][oldest];

        // Strictly older than the retained buffer (or a degenerate single-slot buffer).
        if (target < first.timestamp) revert Errors.InsufficientElapsedTime();
        if (target == first.timestamp) return first.tickCumulative;

        // Binary search for the first slot whose timestamp is strictly greater than target,
        // walking the ring from oldest (l = 0) to newest (r = count - 1).
        uint16 l = 0;
        uint16 r = count - 1;
        while (l < r) {
            uint16 mid = uint16((uint256(l) + r) / 2);
            if (_observations[poolId][(oldest + mid) % OBSERVATION_BUFFER_SIZE].timestamp <= target) {
                l = mid + 1;
            } else {
                r = mid;
            }
        }

        uint16 loIndex = (oldest + l - 1) % OBSERVATION_BUFFER_SIZE;
        Observation storage prior = _observations[poolId][loIndex];

        // Exact hit on a stored observation.
        if (prior.timestamp == target) return prior.tickCumulative;

        // Linear interpolation between the bracketing observations using the prior tick.
        unchecked {
            return prior.tickCumulative + int56(int256(prior.tick)) * int56(uint56(target - prior.timestamp));
        }
    }

    /// @notice Ring-buffer index of the oldest live observation
    function _oldestIndex(uint16 count, uint16 newest) internal pure returns (uint16) {
        return count < OBSERVATION_BUFFER_SIZE ? 0 : (newest + 1) % OBSERVATION_BUFFER_SIZE;
    }

    /// @notice Convert a tick to a 1e18-scaled price (token1 per token0), optionally inverted
    /// @param tick The tick to convert (may be the time-weighted average tick)
    /// @param invert If true, returns the reciprocal price (token0 per token1)
    function _tickToPriceX18(int24 tick, bool invert) internal pure returns (uint256) {
        // price(tick) = 1.0001^tick = (sqrtPriceX96 / 2^96)^2
        uint160 sqrtPriceX96 = TickMath.getSqrtPriceAtTick(tick);

        // priceX96 = sqrtPriceX96^2 / 2^96 (FullMath handles the 512-bit product).
        uint256 priceX96 = FullMath.mulDiv(uint256(sqrtPriceX96), uint256(sqrtPriceX96), FixedPoint96.Q96);

        // Rescale from Q96 to 1e18.
        uint256 priceX18 = FullMath.mulDiv(priceX96, 1e18, FixedPoint96.Q96);

        if (!invert) return priceX18;

        // Pair-direction normalization: compute the reciprocal at FULL PRECISION directly
        // from sqrtPriceX96 — NOT as 1/priceX18 of the already-rounded direct quote, which
        // (a) reverts for negative ticks where priceX18 rounds to zero even though the
        // reciprocal is perfectly representable, and (b) amplifies one-wei direct-price
        // rounding into a large quote error when priceX18 is only a few units.
        //
        //   inverseX18 = 1e18 / price = Q96^2 * 1e18 / sqrtPriceX96^2
        //
        // sqrtPriceX96 is never zero for any tick in TickMath's range (MIN_SQRT_RATIO > 0),
        // so both divisions below are safe. FullMath handles the 512-bit products.
        uint256 q96SquaredOverSqrtP = FullMath.mulDiv(FixedPoint96.Q96, FixedPoint96.Q96, uint256(sqrtPriceX96));
        return FullMath.mulDiv(q96SquaredOverSqrtP, 1e18, uint256(sqrtPriceX96));
    }

    /// @notice Modifier to ensure only PoolManager can call hook callbacks
    modifier onlyPoolManager() {
        if (msg.sender != address(poolManager)) revert Errors.Unauthorized();
        _;
    }
}
