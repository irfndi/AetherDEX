// SPDX-License-Identifier: MIT
pragma solidity ^0.8.31;

import "forge-std/Test.sol";
import {AetherHook} from "src/hook/AetherHook.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {BalanceDelta, toBalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {MockPoolManager} from "../shared/MockPoolManager.sol";

/// @title AetherHook Invariant Tests
/// @notice Property-based (fuzz) invariants for protocol safety + oracle correctness.
/// @dev The handler wraps AetherHook calls and maintains an independent model of the
///      oracle's expected tick-cumulative, so invariants can prove time-weighting under
///      arbitrary fuzzed tick/elapsed-time sequences.

// ─── Handler contract (the fuzzer calls functions on this) ─────────────────
contract AetherHookHandler is Test {
    AetherHook public hook;
    MockPoolManager public mockPoolManager;

    address constant HOOK_ADDR = address(uint160(0x80C0));
    address constant TREASURY = address(0xCAFE);
    address constant OWNER = address(0xBEEF);
    uint24 constant INITIAL_FEE = 30;

    bytes32 public poolId;

    // ── Independent oracle model (mirrors Uniswap v3 two's-complement accumulation) ──
    int56 public expectedCumNow; // expected cumulative extrapolated to `lastTime`
    int24 public lastTick;
    uint32 public lastTime;
    uint16 public modelObservations;
    bool public hasFirst;
    uint32 public firstTime;
    int256 public minTick = type(int256).max;
    int256 public maxTick = type(int256).min;

    // Mirrors the hook's 1024-slot ring so the invariants can clamp queries to the
    // OLDEST RETAINED observation once the buffer overflows (firstTime stays pinned to
    // the first-ever swap, which falls out of the ring after 1024 distinct timestamps).
    uint32[1024] internal _modelTimes;
    uint16 public modelIndex;

    // Handler-owned absolute clock (test-frame block.timestamp can lag cheatcode warps).
    uint32 public clock = 1_000_000_000;

    constructor() {
        mockPoolManager = new MockPoolManager();
        deployCodeTo(
            "AetherHook.sol:AetherHook",
            abi.encode(IPoolManager(address(mockPoolManager)), TREASURY, INITIAL_FEE, OWNER),
            HOOK_ADDR
        );
        hook = AetherHook(HOOK_ADDR);

        // Align the EVM clock with the handler-owned clock from the very first swap.
        vm.warp(clock);

        PoolKey memory key = _testPoolKey();
        poolId = keccak256(abi.encode(key));
    }

    /// @notice Set protocol fee (owner-only)
    function setProtocolFee(uint24 fee) external {
        fee = uint24(bound(fee, 0, 1000));
        vm.prank(OWNER);
        hook.setProtocolFee(fee);
    }

    /// @notice Set treasury address (owner-only, must be non-zero)
    function setTreasury(address newTreasury) external {
        vm.assume(newTreasury != address(0));
        vm.prank(OWNER);
        hook.setTreasury(newTreasury);
    }

    /// @notice Withdraw accrued fees for a pool
    function withdrawFees(bytes32 _poolId) external {
        if (hook.accruedFees0(_poolId) == 0 && hook.accruedFees1(_poolId) == 0) return;
        vm.prank(OWNER);
        hook.withdrawFees(_poolId);
    }

    /// @notice Simulate a swap with a fuzzed terminal tick, after advancing fuzzed time.
    /// @dev Maintains the independent model: `expectedCum += lastTick * dt` (unchecked int56,
    ///      mirroring the hook's two's-complement accumulation); same-timestamp swaps fold.
    function doSwap(bool zeroForOne, uint128 amountIn, uint128 amountOut, int24 tick, uint32 dt) external {
        amountIn = uint128(bound(amountIn, 1, 1e18));
        amountOut = uint128(bound(amountOut, 1, 1e18));
        tick = int24(bound(int256(tick), -200_000, 200_000));
        dt = uint32(bound(dt, 0, 100_000));

        if (dt > 0) {
            clock += dt;
            vm.warp(clock);
        }
        uint32 now_ = clock;

        // Update the model BEFORE recording (matches _recordObservation semantics).
        if (!hasFirst) {
            hasFirst = true;
            firstTime = now_;
            expectedCumNow = 0;
            modelObservations = 1;
            modelIndex = 0;
            _modelTimes[0] = now_;
        } else if (now_ != lastTime) {
            unchecked {
                expectedCumNow += int56(int256(lastTick)) * int56(uint56(now_ - lastTime));
            }
            if (modelObservations < 1024) modelObservations += 1;
            modelIndex = (modelIndex + 1) % 1024;
            _modelTimes[modelIndex] = now_;
        } // else: identical timestamp → fold in place, cumulative unchanged
        lastTick = tick;
        lastTime = now_;
        if (int256(tick) < minTick) minTick = int256(tick);
        if (int256(tick) > maxTick) maxTick = int256(tick);

        // Drive the hook through slot0 + afterSwap.
        mockPoolManager.setSlot0(TickMath.getSqrtPriceAtTick(tick), tick);

        PoolKey memory key = _testPoolKey();
        SwapParams memory params =
            SwapParams({zeroForOne: zeroForOne, amountSpecified: int256(int128(amountIn)), sqrtPriceLimitX96: 0});
        BalanceDelta delta = zeroForOne
            ? toBalanceDelta(int128(amountIn), -int128(amountOut))
            : toBalanceDelta(-int128(amountOut), int128(amountIn));

        vm.prank(address(mockPoolManager));
        hook.afterSwap(address(0xDAD), key, params, delta, "");
    }

    /// @notice Timestamp of the oldest observation still retained in the model's ring
    ///         (mirrors the hook's `_oldestIndex` once the 1024-slot buffer overflows).
    function modelOldestTime() public view returns (uint32) {
        uint16 count = modelObservations;
        return _modelTimes[count < 1024 ? 0 : (modelIndex + 1) % 1024];
    }

    function _testPoolKey() internal pure returns (PoolKey memory) {
        return PoolKey({
            currency0: Currency.wrap(address(0xA000)),
            currency1: Currency.wrap(address(0xB000)),
            fee: 3000,
            tickSpacing: 60,
            hooks: IHooks(address(0))
        });
    }
}

// ─── Invariant test contract ───────────────────────────────────────────────
contract AetherHookInvariantTest is Test {
    AetherHookHandler handler;
    AetherHook hook;

    function setUp() public {
        handler = new AetherHookHandler();
        hook = handler.hook();

        targetContract(address(handler));
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //  STATEFUL INVARIANTS (checked after every call sequence)
    // ═══════════════════════════════════════════════════════════════════════════

    /// @notice Protocol fee never exceeds MAX_PROTOCOL_FEE_BPS (1000 bps = 10%)
    function invariant_protocolFee_bounded() public view {
        assertLe(hook.protocolFeeBps(), hook.MAX_PROTOCOL_FEE_BPS(), "fee must be <= MAX_PROTOCOL_FEE_BPS");
    }

    /// @notice Treasury is never zero address
    function invariant_treasury_nonzero() public view {
        assertTrue(hook.treasury() != address(0), "treasury must never be zero address");
    }

    /// @notice Accrued fees0 are non-negative (uint256, always >= 0 by type)
    function invariant_accruedFees0_nonnegative() public view {
        uint256 f0 = hook.accruedFees0(handler.poolId());
        assertGe(f0, 0, "accruedFees0 must be non-negative");
    }

    /// @notice Accrued fees1 are non-negative
    function invariant_accruedFees1_nonnegative() public view {
        uint256 f1 = hook.accruedFees1(handler.poolId());
        assertGe(f1, 0, "accruedFees1 must be non-negative");
    }

    /// @notice Observation count never exceeds 1024 (circular buffer size)
    function invariant_observationCount_bounded() public view {
        uint16 count = hook.observationCount(handler.poolId());
        assertLe(count, 1024, "observationCount must be <= 1024");
    }

    /// @notice Observation index is always < 1024
    function invariant_observationIndex_bounded() public view {
        uint16 idx = hook.observationIndex(handler.poolId());
        assertLe(idx, 1023, "observationIndex must be < 1024");
    }

    /// @notice Stored observation count matches the independent model (incl. same-block folds)
    function invariant_observationCount_matchesModel() public view {
        assertEq(uint256(hook.observationCount(handler.poolId())), uint256(handler.modelObservations()));
    }

    /// @notice PoolManager address is immutable and never zero
    function invariant_poolManager_nonzero() public view {
        assertTrue(address(hook.poolManager()) != address(0), "poolManager must not be zero");
    }

    /// @notice The oracle's stored cumulative tick matches the independent time-weighted model
    ///         exactly after every action (two's-complement accumulation semantics).
    function invariant_cumulativeTick_matchesModel() public view {
        if (!handler.hasFirst()) return;

        (, int56 storedCumulative,) = hook.getLatestObservation(handler.poolId());
        assertEq(
            storedCumulative, handler.expectedCumNow(), "stored cumulative must equal the elapsed-time-weighted model"
        );
    }

    /// @notice Over the RETAINED observation history, the TWAP tick stays within the
    ///         [min, max] observed across all history (the retained window is a subset,
    ///         so its average cannot leave the overall bounds).
    /// @dev The window is clamped to the oldest RETAINED observation (`modelOldestTime`),
    ///      not the first-ever swap: once the 1024-slot ring overflows, `firstTime` falls
    ///      out of the buffer and `getTwapTick` would (correctly) revert with
    ///      InsufficientElapsedTime — failing the invariant on buffer overflow rather
    ///      than on TWAP correctness.
    function invariant_twapTick_withinObservedRange() public view {
        if (handler.modelObservations() < 2) return;

        uint32 oldestRetained = handler.modelOldestTime();
        uint32 last = handler.lastTime();
        if (last <= oldestRetained) return;

        // Window [oldestRetained, now]: the view call's frame sees the correctly warped "now".
        uint32 window = last - oldestRetained;
        int256 avg = int256(hook.getTwapTick(handler.poolId(), window));
        assertGe(avg, handler.minTick(), "TWAP tick must be >= min observed tick");
        assertLe(avg, handler.maxTick(), "TWAP tick must be <= max observed tick");
    }
}
