// SPDX-License-Identifier: MIT
pragma solidity ^0.8.31;

import "forge-std/Test.sol";
import {AetherHook} from "src/hook/AetherHook.sol";
import {Errors} from "src/lib/Errors.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {BalanceDelta, toBalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {FullMath} from "@uniswap/v4-core/src/libraries/FullMath.sol";
import {FixedPoint96} from "@uniswap/v4-core/src/libraries/FixedPoint96.sol";
import {MockPoolManager} from "../shared/MockPoolManager.sol";

/// @title AetherHook TWAP Oracle — deterministic correctness suite (Plan §9 G2.5)
/// @notice Proves the oracle is a TRUE time-weighted average of POOL STATE (slot0 tick),
///         not of swap execution prices: known multi-observation sequences with known
///         elapsed times must yield the exact expected time-weighted tick and price.
contract AetherHookTwapTest is Test {
    AetherHook internal hook;
    MockPoolManager internal mockPoolManager;

    address internal constant HOOK_ADDR = address(uint160(0x80C0));
    address internal constant TREASURY = address(0xCAFE);

    bytes32 internal poolId;

    // Test-owned absolute clock: the test frame's `block.timestamp` read can lag cheatcode
    // warps, so tests drive time exclusively through this shadow clock + absolute warps.
    uint256 internal _clock = 1_000_000_000;

    function setUp() public {
        vm.warp(_clock);
        mockPoolManager = new MockPoolManager();
        deployCodeTo(
            "AetherHook.sol:AetherHook",
            abi.encode(IPoolManager(address(mockPoolManager)), TREASURY, uint24(0), address(this)),
            HOOK_ADDR
        );
        hook = AetherHook(HOOK_ADDR);

        PoolKey memory key = PoolKey({
            currency0: Currency.wrap(address(0xA000)),
            currency1: Currency.wrap(address(0xB000)),
            fee: 3000,
            tickSpacing: 60,
            hooks: IHooks(address(0))
        });
        poolId = keccak256(abi.encode(key));
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //  EXACT MULTI-OBSERVATION SEQUENCE (time-weighting, not sample-counting)
    // ═══════════════════════════════════════════════════════════════════════════

    /// @notice Schedule: tick -500 held 100s, then +1500 held 200s, then +200 held 50s.
    ///         Any window must equal the elapsed-time-weighted tick average, computed here
    ///         independently and asserted exactly (integer division, floored).
    function test_twap_exactKnownSequence_allWindows() public {
        _swapAtTick(-500); // obs0 @ t=0: cum 0
        _advance(100);
        _swapAtTick(1500); // obs1 @ t=100: cum = -500*100 = -50_000
        _advance(200);
        _swapAtTick(200); // obs2 @ t=300: cum = -50_000 + 1500*200 = 250_000
        _advance(50); // now t=350: cum(now) = 250_000 + 200*50 = 260_000

        // Full window: (260_000 - 0) / 350 = 742
        assertEq(int256(hook.getTwapTick(poolId, 350)), 742, "full window");

        // Middle window [t=50, t=350] = 300s:
        //   cum(t=50)  = interp: 0 + (-500)*50          = -25_000
        //   cum(now)   = 260_000  -> avg = 285_000/300  = 950
        assertEq(int256(hook.getTwapTick(poolId, 300)), 950, "300s window with interpolation");

        // Window exactly aligned to the second observation [t=100, t=350] = 250s:
        //   cum(t=100) = -50_000 (exact hit) -> avg = 310_000/250 = 1240
        assertEq(int256(hook.getTwapTick(poolId, 250)), 1240, "exact-boundary window");

        // Short window [t=325, t=350] = 25s entirely within the last span:
        //   cum(t=325) = 250_000 + 200*25 = 255_000 -> avg = 5_000/25 = 200
        assertEq(int256(hook.getTwapTick(poolId, 25)), 200, "intra-span window");

        // Price at the full-window avg tick, exactly.
        assertEq(hook.getCurrentTwap(poolId, 350), _priceX18AtTick(742), "price(twap tick)");
        assertEq(hook.getCurrentTwapInverted(poolId, 350), _invertPriceX18AtTick(742), "reciprocal price");
    }

    /// @notice Cross-tick sequence from the plan's example: +6000 for 30s then -6000 for 70s.
    ///         100s window avg = (6000*30 + (-6000)*70)/100 = -2400, exactly.
    function test_twap_crossTick_exactAverage() public {
        _swapAtTick(6000); // t=0
        _advance(30);
        _swapAtTick(-6000); // t=30: cum = 6000*30 = 180_000
        _advance(70); // t=100: cum(now) = 180_000 + (-6000)*70 = -240_000

        int24 avgTick = hook.getTwapTick(poolId, 100);
        assertEq(int256(avgTick), -2400, "cross-tick time-weighted average");
        assertLt(int256(avgTick), 0, "negative average must be representable");

        // The price of the average tick must sit between the two spot prices.
        uint256 twapPrice = hook.getCurrentTwap(poolId, 100);
        assertEq(twapPrice, _priceX18AtTick(-2400));
        assertLt(twapPrice, _priceX18AtTick(6000), "twap < high spot");
        assertGt(twapPrice, _priceX18AtTick(-6000), "twap > low spot");
    }

    /// @notice Time-weighting must dominate sample-counting: tick 0 held 1s, then 99 samples
    ///         at tick 1000 spanning 99s → TWAP(100s) = 990 by elapsed time. The discriminating
    ///         check is the [now-1, now] window (pure tick 1000). This is the bug G2.5 fixes.
    function test_twap_timeWeightsNotSampleCounts() public {
        _swapAtTick(0); // t=0
        for (uint256 i = 0; i < 99; i++) {
            _advance(1);
            _swapAtTick(1000);
        }
        // Deterministic trace: obs0 @ t0 (tick 0, cum 0); the 99 tick-1000 swaps land at
        // t0+1..t0+99; the final advance puts now at t0+100. Tick 0 is held for exactly 1s.
        _advance(1); // now = t0+100

        int56 cumNow = _nowCumulative();
        int24 avg = hook.getTwapTick(poolId, 100);

        // Independent expectation: trace the same write semantics.
        // obs0 @ t=0 tick0=0; obs1 @ t=1 tick1=1000 (cum 0); obs2..obs99 @ t=2..99 tick=1000
        // cum(now=100) = 0*1 + 1000*(99) = 99_000 → avg over 100s = 990.
        assertEq(int56(cumNow), int56(99_000), "cumulative now");
        assertEq(int256(avg), 990, "time-weighted: tick 0 held only 1s");

        // A sample-counting oracle would answer 990 only by coincidence of this trace;
        // assert the discriminating window [now-1, now] is pure tick 1000:
        assertEq(int256(hook.getTwapTick(poolId, 1)), 1000, "last second is entirely tick 1000");
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //  PAIR-DIRECTION NORMALIZATION (reciprocal reads)
    // ═══════════════════════════════════════════════════════════════════════════

    function test_twap_invertedPrice_isReciprocal() public {
        _swapAtTick(6000);
        _advance(60);
        _swapAtTick(6000);
        _advance(60);

        uint256 direct = hook.getCurrentTwap(poolId, 120);
        uint256 inverted = hook.getCurrentTwapInverted(poolId, 120);

        assertEq(direct, _priceX18AtTick(6000), "direct = spot price in token1/token0");
        assertEq(inverted, _invertPriceX18AtTick(6000), "inverted = full-precision 1e18-scaled reciprocal");

        // Round-trip product ≈ 1e36 within integer flooring (< 0.01% error).
        assertApproxEqRel(FullMath.mulDiv(direct, inverted, 1e18), 1e18, 1e14, "p * (1/p) ~= 1");
    }

    function test_twap_zeroTick_priceAndReciprocalAreBothOne() public {
        _swapAtTick(0);
        _advance(30);
        _swapAtTick(0);
        _advance(30);

        assertEq(hook.getCurrentTwap(poolId, 60), 1e18, "tick 0 -> price exactly 1e18");
        assertEq(hook.getCurrentTwapInverted(poolId, 60), 1e18, "tick 0 -> reciprocal exactly 1e18");
    }

    function test_twap_negativeTickCountercy() public {
        // tick -300_000 -> price ~9.36e4 at 1e18 scale (small, but representable: the
        // reciprocal read requires price >= 1 at this scale, i.e. tick > ~ -414_000).
        _swapAtTick(-300_000);
        _advance(20);
        _swapAtTick(-300_000);
        _advance(20);

        uint256 direct = hook.getCurrentTwap(poolId, 40);
        uint256 inverted = hook.getCurrentTwapInverted(poolId, 40);
        assertGt(inverted, direct, "small price -> reciprocal is larger");
        assertApproxEqRel(FullMath.mulDiv(direct, inverted, 1e18), 1e18, 1e14, "reciprocal identity");
    }

    function test_twap_invertedReadable_evenWhenDirectFloorsToZero() public {
        // tick -460_517 -> price ~1e-20, which floors to 0 at 1e18 scale. The reciprocal
        // (~1e38 at this scale) IS representable, so a full-precision inverse computed
        // directly from sqrtPriceX96 must return an accurate value instead of reverting
        // on the already-rounded direct quote (which is exactly what keepers read in the
        // reverse direction).
        _swapAtTick(-460_517);
        _advance(20);
        _swapAtTick(-460_517);
        _advance(20);

        assertEq(hook.getCurrentTwap(poolId, 40), 0, "direct price floors to zero at this tick");

        uint256 inverted = hook.getCurrentTwapInverted(poolId, 40);
        assertGt(inverted, 0, "reverse read stays representable when the direct quote rounds to zero");
        assertEq(inverted, _invertPriceX18AtTick(-460_517), "full-precision reciprocal of the TWAP tick");
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //  RING-BUFFER WRAPAROUND AT 1024
    // ═══════════════════════════════════════════════════════════════════════════

    /// @notice Fill past the 1024-slot ring with alternating ticks; every window up to the
    ///         retained depth must match an independent trace — including windows that span
    ///         the physical array wrap. Deep windows past the buffer must revert.
    struct Trace {
        int24[] ticks;
        uint32[] times;
        int256[] cums;
    }

    function test_twap_wraparound_exactAgainstTrace() public {
        uint256 n = 1100; // observations (wraps once)
        Trace memory trace = _recordTrace(n);

        uint32 now_ = uint32(_clock);
        int256 cumNow = trace.cums[n - 1] + int256(trace.ticks[n - 1]) * int256(uint256(now_ - trace.times[n - 1]));

        // Retained depth: 1024 observations * 3s = oldest retained at times[n-1024].
        uint256 oldestRetained = n - 1024;
        assertEq(hook.observationCount(poolId), 1024, "saturated ring");

        // Window aligned exactly on the oldest retained observation.
        uint32 windowExact = now_ - trace.times[oldestRetained];
        _assertWindow(windowExact, cumNow, trace.cums[oldestRetained], "oldest-aligned window");

        // Interpolated window: window start 2s after the oldest retained observation
        // (falls inside its 3s holding span → requires linear interpolation).
        uint32 target = trace.times[oldestRetained] + 2;
        int256 cumAtTarget = trace.cums[oldestRetained] + int256(trace.ticks[oldestRetained])
            * int256(uint256(target - trace.times[oldestRetained]));
        _assertWindow(now_ - target, cumNow, cumAtTarget, "interpolated window across wrap");

        // Deep window that crosses the physical wrap at several points.
        _assertWindow(now_ - trace.times[n - 900], cumNow, trace.cums[n - 900], "deep window");

        // Older than the buffer → revert.
        vm.expectRevert(Errors.InsufficientElapsedTime.selector);
        hook.getTwapTick(poolId, windowExact + 10);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //  EDGE CASES & GUARDS
    // ═══════════════════════════════════════════════════════════════════════════

    function test_observe_exactInterpolatedExtrapolated() public {
        _swapAtTick(10); // t=0
        _advance(100);
        _swapAtTick(20); // t=100: cum=1000
        _advance(50); // now=150: cum(now)=1000+20*50=2000

        uint32[] memory agos = new uint32[](4);
        agos[0] = 0; // extrapolate -> 2000
        agos[1] = 25; // t=125: 1000 + 20*25 = 1500
        agos[2] = 50; // t=100 exact obs -> 1000
        agos[3] = 150; // t=0 first obs -> 0
        int56[] memory cums = hook.observe(poolId, agos);

        assertEq(cums[0], int56(2000));
        assertEq(cums[1], int56(1500));
        assertEq(cums[2], int56(1000));
        assertEq(cums[3], int56(0));
    }

    function test_observe_interpolationUsesPriorTick() public {
        _swapAtTick(100); // t=0
        _advance(60);
        _swapAtTick(300); // t=60: cum = 6000
        _advance(60);

        // t=30 (30s ago = agos 90): within first span, prior tick = 100 → cum = 3000
        uint32[] memory agos = new uint32[](1);
        agos[0] = 90;
        int56[] memory cums = hook.observe(poolId, agos);
        assertEq(cums[0], int56(3000), "interpolation weights by the PRECEDING terminal tick");
    }

    function test_observe_negativeCumulatives() public {
        _swapAtTick(-1000);
        _advance(10);
        _swapAtTick(500);
        _advance(10);

        uint32[] memory agos = new uint32[](1);
        agos[0] = 0;
        int56[] memory cums = hook.observe(poolId, agos);
        // cum(now) = -1000*10 + 500*10 = -5000
        assertLt(cums[0], 0, "cumulatives must support negative values");
        assertEq(cums[0], int56(-5000));
    }

    function test_twap_sameTimestampNeverDividesByZero() public {
        _swapAtTick(111);
        _swapAtTick(222); // same block — folded
        _advance(5);
        _swapAtTick(333);

        // Only 2 stored observations (slot0 folded); window spans real elapsed time only.
        assertEq(hook.observationCount(poolId), 2);
        int24 avg = hook.getTwapTick(poolId, 5);
        // cum(now) = 222*5 = 1110; avg = 1110/5 = 222
        assertEq(int256(avg), 222, "folded same-timestamp tick still weighted correctly");
    }

    function test_getTwapTick_revertGuards() public {
        // secondsAgo == 0
        _swapAtTick(1);
        _advance(5);
        _swapAtTick(2);
        _advance(5);

        vm.expectRevert(Errors.InsufficientElapsedTime.selector);
        hook.getTwapTick(poolId, 0);

        // Unknown pool → no observations
        vm.expectRevert(Errors.InsufficientObservations.selector);
        hook.getTwapTick(bytes32("unknown"), 5);
    }

    function test_twap_firstObservationOnly_neverComputable() public {
        _swapAtTick(42);
        _advance(100);

        vm.expectRevert(Errors.InsufficientObservations.selector);
        hook.getCurrentTwap(poolId, 100);

        // observe() still answers for now (extrapolation) but not past the only sample.
        uint32[] memory agos = new uint32[](1);
        agos[0] = 99; // target = t=1 (single obs was at t=0) → extrapolates 42 * 1s = 42
        int56[] memory cums = hook.observe(poolId, agos);
        assertEq(cums[0], int56(42), "single tick extrapolated over 1s");

        agos[0] = 101; // target = t=-1, before the only observation → revert
        vm.expectRevert(Errors.InsufficientElapsedTime.selector);
        hook.observe(poolId, agos);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //  FUZZ: exact time-weighted tick & price identity
    // ═══════════════════════════════════════════════════════════════════════════

    function testFuzz_twap_exactTimeWeighting(int24 a, int24 b, int24 c, uint32 da, uint32 db, uint32 dc) public {
        a = int24(bound(a, -200_000, 200_000));
        b = int24(bound(b, -200_000, 200_000));
        c = int24(bound(c, -200_000, 200_000));
        da = uint32(bound(da, 1, 1 hours));
        db = uint32(bound(db, 1, 1 hours));
        dc = uint32(bound(dc, 1, 1 hours));

        _swapAtTick(a);
        _advance(uint256(da));
        _swapAtTick(b);
        _advance(uint256(db));
        _swapAtTick(c);
        _advance(uint256(dc));

        uint32 window = da + db + dc;
        int256 weighted =
            int256(a) * int256(uint256(da)) + int256(b) * int256(uint256(db)) + int256(c) * int256(uint256(dc));
        // The hook floors negative averages (rounds toward negative infinity) rather than
        // truncating toward zero — mirror that here.
        int256 denom = int256(uint256(window));
        int256 expectedTick = weighted / denom;
        if (weighted < 0 && weighted % denom != 0) expectedTick -= 1;

        int24 actual = hook.getTwapTick(poolId, window);
        assertEq(int256(actual), expectedTick, "exact elapsed-time weighting over 3 spans");

        // Price must be the deterministic conversion of that exact tick.
        assertEq(hook.getCurrentTwap(poolId, window), _priceX18AtTick(actual), "price(tick) identity");

        // Reciprocal read must be the exact full-precision 1e18-scaled reciprocal of the tick.
        assertEq(hook.getCurrentTwapInverted(poolId, window), _invertPriceX18AtTick(actual), "reciprocal identity");
    }

    function testFuzz_twapTickWithinObservedRange(int24 a, int24 b, uint32 da, uint32 db) public {
        a = int24(bound(a, -100_000, 100_000));
        b = int24(bound(b, -100_000, 100_000));
        da = uint32(bound(da, 1, 1 days));
        db = uint32(bound(db, 1, 1 days));

        _swapAtTick(a);
        _advance(uint256(da));
        _swapAtTick(b);
        _advance(uint256(db));

        int24 avg = hook.getTwapTick(poolId, da + db);
        int24 lo = a < b ? a : b;
        int24 hi = a > b ? a : b;
        assertGe(int256(avg), int256(lo), "TWAP tick >= min observed");
        assertLe(int256(avg), int256(hi), "TWAP tick <= max observed");
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //  HELPERS
    // ═══════════════════════════════════════════════════════════════════════════

    /// @dev Set pool state to `tick` and execute a swap so the oracle samples it.
    function _swapAtTick(int24 tick) internal {
        mockPoolManager.setSlot0(TickMath.getSqrtPriceAtTick(tick), tick);
        PoolKey memory key = PoolKey({
            currency0: Currency.wrap(address(0xA000)),
            currency1: Currency.wrap(address(0xB000)),
            fee: 3000,
            tickSpacing: 60,
            hooks: IHooks(address(0))
        });
        SwapParams memory params = SwapParams({zeroForOne: true, amountSpecified: 1e9, sqrtPriceLimitX96: 0});

        vm.prank(address(mockPoolManager));
        hook.afterSwap(address(0xDAD), key, params, toBalanceDelta(1e9, -1e9), "");
    }

    /// @dev Extrapolated cumulative at "now" (observe([0])).
    function _nowCumulative() internal view returns (int56 cumNow) {
        uint32[] memory agos = new uint32[](1);
        agos[0] = 0;
        int56[] memory cums = hook.observe(poolId, agos);
        return cums[0];
    }

    function _priceX18AtTick(int24 tick) internal pure returns (uint256) {
        uint256 p = uint256(TickMath.getSqrtPriceAtTick(tick));
        uint256 priceX96 = FullMath.mulDiv(p, p, FixedPoint96.Q96);
        return FullMath.mulDiv(priceX96, 1e18, FixedPoint96.Q96);
    }

    /// @dev The exact 1e18-scaled reciprocal of `price(tick)`, computed at full precision
    ///      directly from sqrtPriceX96: `Q96^2 * 1e18 / sqrtPriceX96^2` (mirrors the hook —
    ///      NOT the naive 1e36/round(priceX18), which rounds away precision).
    function _invertPriceX18AtTick(int24 tick) internal pure returns (uint256) {
        uint256 p = uint256(TickMath.getSqrtPriceAtTick(tick));
        uint256 q96SquaredOverSqrtP = FullMath.mulDiv(FixedPoint96.Q96, FixedPoint96.Q96, p);
        return FullMath.mulDiv(q96SquaredOverSqrtP, 1e18, p);
    }

    /// @dev Advance time by `dt` seconds using the test-owned absolute clock.
    function _advance(uint256 dt) internal {
        _clock += dt;
        vm.warp(_clock);
    }

    /// @dev Record `n` alternating-tick observations spaced 3s apart into an independent trace.
    function _recordTrace(uint256 n) internal returns (Trace memory trace) {
        trace.ticks = new int24[](n);
        trace.times = new uint32[](n);
        trace.cums = new int256[](n);

        for (uint256 i = 0; i < n; i++) {
            int24 tick = i % 2 == 0 ? int24(300) : int24(-100);
            _swapAtTick(tick);
            trace.ticks[i] = tick;
            trace.times[i] = uint32(_clock);
            trace.cums[i] = i == 0
                ? int256(0)
                : trace.cums[i - 1] + int256(trace.ticks[i - 1]) * int256(uint256(trace.times[i] - trace.times[i - 1]));
            _advance(3); // 3s between observations
        }
        _advance(7); // 10s since last observation
    }

    /// @dev The hook's TWAP over `window` must equal the trace-independent average
    ///      `(cumNow - cumStart) / window`, floored toward negative infinity (the hook no
    ///      longer truncates negative divisions toward zero).
    function _assertWindow(uint32 window, int256 cumNow, int256 cumStart, string memory label) internal view {
        int256 numerator = cumNow - cumStart;
        int256 denom = int256(uint256(window));
        int256 expected = numerator / denom;
        if (numerator < 0 && numerator % denom != 0) expected -= 1;
        assertEq(int256(hook.getTwapTick(poolId, window)), expected, label);
    }
}
