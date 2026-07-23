// SPDX-License-Identifier: MIT
pragma solidity ^0.8.31;

import "forge-std/Test.sol";
import {AetherHook} from "src/hook/AetherHook.sol";
import {Errors} from "src/lib/Errors.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {BalanceDelta, toBalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {BeforeSwapDelta, BeforeSwapDeltaLibrary} from "@uniswap/v4-core/src/types/BeforeSwapDelta.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {SwapParams, ModifyLiquidityParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {FullMath} from "@uniswap/v4-core/src/libraries/FullMath.sol";
import {FixedPoint96} from "@uniswap/v4-core/src/libraries/FixedPoint96.sol";
import {MockPoolManager} from "../shared/MockPoolManager.sol";

/// @title AetherHook Unit Tests
/// @notice Tests for AetherHook — protocol fee capture, v3-style TWAP oracle, access control
/// @dev Hook address must have bits 6 and 7 set (BEFORE_SWAP_FLAG | AFTER_SWAP_FLAG).
///      We deploy via `deployCodeTo` to a controlled address, then cast. The hook's oracle
///      read (slot0) is served by a MockPoolManager implementing `extsload`.
contract AetherHookTest is Test {
    AetherHook hook;
    MockPoolManager mockPoolManager;

    // Target address with bits 6 (0x40) and 7 (0x80) set → lowest byte must be 0xC0+
    address constant HOOK_ADDR = address(uint160(0x80C0));
    address constant TREASURY = address(0xCAFE);
    address constant NOT_OWNER = address(0xBAD);
    uint24 constant PROTOCOL_FEE_BPS = 30; // 0.30%

    // Tokens for PoolKey construction
    address constant TOKEN0 = address(0xA000);
    address constant TOKEN1 = address(0xB000);

    // Pre-computed poolId from the test PoolKey
    bytes32 poolId;

    // Test-owned absolute clock: the test frame's `block.timestamp` read can lag cheatcode
    // warps, so tests drive time exclusively through this shadow clock + absolute warps.
    uint256 internal _clock = 1_000_000_000;

    function setUp() public {
        vm.warp(_clock);
        // Mock PoolManager provides the slot0 extsload read used by the oracle.
        mockPoolManager = new MockPoolManager();

        // Deploy AetherHook at an address with correct hook permission bits
        // deployCodeTo returns void; the contract lives at HOOK_ADDR after the call
        deployCodeTo(
            "AetherHook.sol:AetherHook",
            abi.encode(IPoolManager(address(mockPoolManager)), TREASURY, PROTOCOL_FEE_BPS, address(this)),
            HOOK_ADDR
        );
        hook = AetherHook(HOOK_ADDR);
        assertEq(address(hook), HOOK_ADDR, "Hook must be deployed at controlled address");

        // Compute poolId from the same PoolKey used in tests
        PoolKey memory key = _testPoolKey();
        poolId = keccak256(abi.encode(key));

        // Default pool state: tick 100 (price > 1)
        _setTick(100);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //  CONSTRUCTOR
    // ═══════════════════════════════════════════════════════════════════════════

    function test_constructor_setsCorrectValues() public view {
        assertEq(address(hook.poolManager()), address(mockPoolManager));
        assertEq(hook.treasury(), TREASURY);
        assertEq(hook.protocolFeeBps(), PROTOCOL_FEE_BPS);
        assertEq(hook.owner(), address(this));
    }

    function test_constructor_revertsZeroTreasury() public {
        vm.expectRevert(Errors.ZeroAddress.selector);
        deployCodeTo(
            "AetherHook.sol:AetherHook",
            abi.encode(IPoolManager(address(mockPoolManager)), address(0), PROTOCOL_FEE_BPS, address(this)),
            address(uint160(0x80C1))
        );
    }

    function test_constructor_revertsFeeTooHigh() public {
        vm.expectRevert(AetherHook.FeeTooHigh.selector);
        deployCodeTo(
            "AetherHook.sol:AetherHook",
            abi.encode(IPoolManager(address(mockPoolManager)), TREASURY, 1001, address(this)),
            address(uint160(0x80C2))
        );
    }

    function test_constructor_acceptsMaxFee() public {
        // Deploy at address with valid hook bits (lower 14 bits = 0xC0)
        deployCodeTo(
            "AetherHook.sol:AetherHook",
            abi.encode(IPoolManager(address(mockPoolManager)), TREASURY, 1000, address(this)),
            address(uint160(0x200C0))
        );
        assertTrue(true);
    }

    function test_constructor_acceptsZeroFee() public {
        deployCodeTo(
            "AetherHook.sol:AetherHook",
            abi.encode(IPoolManager(address(mockPoolManager)), TREASURY, 0, address(this)),
            address(uint160(0x300C0))
        );
        assertTrue(true);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //  SET PROTOCOL FEE
    // ═══════════════════════════════════════════════════════════════════════════

    function test_setProtocolFee_onlyOwner() public {
        vm.prank(NOT_OWNER);
        vm.expectRevert(abi.encodeWithSignature("OwnableUnauthorizedAccount(address)", NOT_OWNER));
        hook.setProtocolFee(50);
    }

    function test_setProtocolFee_revertsTooHigh() public {
        vm.expectRevert(AetherHook.FeeTooHigh.selector);
        hook.setProtocolFee(1001);
    }

    function test_setProtocolFee_emitsEvent() public {
        vm.expectEmit(true, true, true, true);
        emit AetherHook.ProtocolFeeUpdated(PROTOCOL_FEE_BPS, 50);
        hook.setProtocolFee(50);
    }

    function test_setProtocolFee_updatesState() public {
        hook.setProtocolFee(50);
        assertEq(hook.protocolFeeBps(), 50);
    }

    function test_setProtocolFee_toZero() public {
        hook.setProtocolFee(0);
        assertEq(hook.protocolFeeBps(), 0);
    }

    function test_setProtocolFee_toMax() public {
        hook.setProtocolFee(1000);
        assertEq(hook.protocolFeeBps(), 1000);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //  SET TREASURY
    // ═══════════════════════════════════════════════════════════════════════════

    function test_setTreasury_onlyOwner() public {
        vm.prank(NOT_OWNER);
        vm.expectRevert(abi.encodeWithSignature("OwnableUnauthorizedAccount(address)", NOT_OWNER));
        hook.setTreasury(address(0xBEEF));
    }

    function test_setTreasury_revertsZero() public {
        vm.expectRevert(Errors.ZeroAddress.selector);
        hook.setTreasury(address(0));
    }

    function test_setTreasury_updates() public {
        address newTreasury = address(0xBEEF);
        hook.setTreasury(newTreasury);
        assertEq(hook.treasury(), newTreasury);
    }

    function test_setTreasury_emitsEvent() public {
        address newTreasury = address(0xBEEF);
        vm.expectEmit(true, true, true, true);
        emit AetherHook.TreasuryUpdated(TREASURY, newTreasury);
        hook.setTreasury(newTreasury);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //  WITHDRAW FEES
    // ═══════════════════════════════════════════════════════════════════════════

    function test_withdrawFees_onlyOwner() public {
        vm.prank(NOT_OWNER);
        vm.expectRevert(abi.encodeWithSignature("OwnableUnauthorizedAccount(address)", NOT_OWNER));
        hook.withdrawFees(poolId);
    }

    function test_withdrawFees_zeroAmountReverts() public {
        vm.expectRevert(Errors.ZeroAmount.selector);
        hook.withdrawFees(poolId);
    }

    function test_withdrawFees_success() public {
        // Accrue some fees first
        _doSwap(true, 1000, 500); // zeroForOne, amountIn=1000, amountOut=500

        uint256 feeBefore = hook.accruedFees0(poolId);
        assertGt(feeBefore, 0, "Should have accrued fees");

        vm.expectEmit(true, true, true, true);
        emit AetherHook.FeesWithdrawn(poolId, TREASURY, feeBefore, 0);
        hook.withdrawFees(poolId);

        assertEq(hook.accruedFees0(poolId), 0, "Fees should be zero after withdrawal");
        assertEq(hook.accruedFees1(poolId), 0, "Fees1 should remain zero");
    }

    function test_withdrawFees_bothTokens() public {
        _doSwap(true, 1000, 500); // fee in token0
        _doSwap(false, 1000, 500); // fee in token1

        uint256 fee0 = hook.accruedFees0(poolId);
        uint256 fee1 = hook.accruedFees1(poolId);
        assertGt(fee0, 0, "Should have accrued fees0");
        assertGt(fee1, 0, "Should have accrued fees1");

        hook.withdrawFees(poolId);

        assertEq(hook.accruedFees0(poolId), 0);
        assertEq(hook.accruedFees1(poolId), 0);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //  HOOK CALLBACK ACCESS CONTROL (onlyPoolManager)
    // ═══════════════════════════════════════════════════════════════════════════

    function test_beforeSwap_revertsNonPoolManager() public {
        PoolKey memory key = _testPoolKey();
        SwapParams memory params = _swapParams(true, 1000);

        vm.prank(NOT_OWNER);
        vm.expectRevert(Errors.Unauthorized.selector);
        hook.beforeSwap(address(0xDAD), key, params, "");
    }

    function test_afterSwap_revertsNonPoolManager() public {
        PoolKey memory key = _testPoolKey();
        SwapParams memory params = _swapParams(true, 1000);

        vm.prank(NOT_OWNER);
        vm.expectRevert(Errors.Unauthorized.selector);
        hook.afterSwap(address(0xDAD), key, params, toBalanceDelta(1000, -500), "");
    }

    function test_beforeSwap_succeedsFromPoolManager() public {
        PoolKey memory key = _testPoolKey();
        SwapParams memory params = _swapParams(true, 1000);

        vm.prank(address(mockPoolManager));
        (bytes4 selector, BeforeSwapDelta delta, uint24 fee) = hook.beforeSwap(address(0xDAD), key, params, "");

        assertEq(selector, hook.beforeSwap.selector);
        assertEq(BeforeSwapDeltaLibrary.getSpecifiedDelta(delta), 0);
        assertEq(BeforeSwapDeltaLibrary.getUnspecifiedDelta(delta), 0);
        assertEq(fee, 0);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //  UNIMPLEMENTED HOOKS (revert with "not implemented")
    // ═══════════════════════════════════════════════════════════════════════════

    function test_beforeInitialize_reverts() public {
        vm.expectRevert();
        hook.beforeInitialize(address(0xDAD), _testPoolKey(), 0);
    }

    function test_afterInitialize_reverts() public {
        vm.expectRevert();
        hook.afterInitialize(address(0xDAD), _testPoolKey(), 0, 0);
    }

    function test_beforeAddLiquidity_reverts() public {
        vm.expectRevert();
        hook.beforeAddLiquidity(address(0xDAD), _testPoolKey(), _modifyLiqParams(), "");
    }

    function test_afterAddLiquidity_reverts() public {
        vm.expectRevert();
        hook.afterAddLiquidity(
            address(0xDAD), _testPoolKey(), _modifyLiqParams(), BalanceDelta.wrap(0), BalanceDelta.wrap(0), ""
        );
    }

    function test_beforeRemoveLiquidity_reverts() public {
        vm.expectRevert();
        hook.beforeRemoveLiquidity(address(0xDAD), _testPoolKey(), _modifyLiqParams(), "");
    }

    function test_afterRemoveLiquidity_reverts() public {
        vm.expectRevert();
        hook.afterRemoveLiquidity(
            address(0xDAD), _testPoolKey(), _modifyLiqParams(), BalanceDelta.wrap(0), BalanceDelta.wrap(0), ""
        );
    }

    function test_beforeDonate_reverts() public {
        vm.expectRevert();
        hook.beforeDonate(address(0xDAD), _testPoolKey(), 1e18, 1e18, "");
    }

    function test_afterDonate_reverts() public {
        vm.expectRevert();
        hook.afterDonate(address(0xDAD), _testPoolKey(), 1e18, 1e18, "");
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //  AFTER SWAP — FEE ACCRUAL
    // ═══════════════════════════════════════════════════════════════════════════

    function test_afterSwap_zeroForOne_accruesFeeToken0() public {
        _doSwap(true, 1000, 500);
        // Fee = 1000 * 30 / 10000 = 3
        assertEq(hook.accruedFees0(poolId), 3, "Fee in token0 should be 3");
        assertEq(hook.accruedFees1(poolId), 0, "Fee in token1 should be 0");
    }

    function test_afterSwap_oneForZero_accruesFeeToken1() public {
        _doSwap(false, 1000, 500);
        assertEq(hook.accruedFees0(poolId), 0, "Fee in token0 should be 0");
        assertEq(hook.accruedFees1(poolId), 3, "Fee in token1 should be 3");
    }

    function test_afterSwap_zeroFee_noAccrual() public {
        hook.setProtocolFee(0);
        _doSwap(true, 1000, 500);
        assertEq(hook.accruedFees0(poolId), 0, "No fees should accrue with zero fee");
    }

    function test_afterSwap_feesAccumulateOverMultipleSwaps() public {
        _doSwap(true, 1000, 500); // fee = 3
        _doSwap(true, 2000, 1000); // fee = 6
        _doSwap(true, 1000, 500); // fee = 3
        assertEq(hook.accruedFees0(poolId), 12, "Fees should accumulate: 3 + 6 + 3 = 12");
    }

    function test_afterSwap_returnsCorrectSelector() public {
        PoolKey memory key = _testPoolKey();
        SwapParams memory params = _swapParams(true, 1000);
        BalanceDelta delta = toBalanceDelta(1000, -500);

        vm.prank(address(mockPoolManager));
        (bytes4 selector, int128 deltaAmt) = hook.afterSwap(address(0xDAD), key, params, delta, "");

        assertEq(selector, hook.afterSwap.selector);
        assertEq(deltaAmt, 0, "afterSwap should return zero delta");
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //  AFTER SWAP — ORACLE OBSERVATIONS (pool-state tick sampling)
    // ═══════════════════════════════════════════════════════════════════════════

    function test_afterSwap_recordsObservationFromPoolState() public {
        _setTick(5000);
        _doSwap(true, 1000, 500);

        assertEq(hook.observationCount(poolId), 1, "Should have 1 observation");
        assertEq(hook.observationIndex(poolId), 0, "First observation lives in slot 0");

        (uint32 ts, int56 cum, int24 tick, bool initialized) = hook.observationAt(poolId, 0);
        assertEq(ts, uint32(block.timestamp), "timestamp must be block.timestamp");
        assertEq(cum, 0, "first observation has zero cumulative");
        assertEq(tick, 5000, "observation stores the pool's terminal tick, not execution price");
        assertTrue(initialized, "slot must be initialized");
    }

    function test_afterSwap_multipleSwaps_accumulateObservations() public {
        _doSwap(true, 1000, 500);
        _advance(10);
        _doSwap(true, 2000, 800);
        _advance(20);
        _doSwap(true, 1500, 600);
        assertEq(hook.observationCount(poolId), 3, "Should have 3 observations");
        assertEq(hook.observationIndex(poolId), 2, "newest observation index advances");
    }

    function test_afterSwap_recordsTickNotExecutionPrice() public {
        // Wildly mismatched amountIn/amountOut must NOT affect the recorded price —
        // the oracle samples slot0 tick state, which is identical for both swaps.
        _setTick(1234);
        _doSwap(true, 1_000_000, 1);

        _advance(60);
        _doSwap(true, 1, 1_000_000);

        assertEq(hook.observationCount(poolId), 2, "both swaps recorded");
        (,, int24 tick0,) = hook.observationAt(poolId, 0);
        (,, int24 tick1,) = hook.observationAt(poolId, 1);
        assertEq(tick0, 1234, "first observation = slot0 tick");
        assertEq(tick1, 1234, "second observation = slot0 tick");
    }

    function test_afterSwap_noObservationWhenZeroAmountIn() public {
        PoolKey memory key = _testPoolKey();
        SwapParams memory params = _swapParams(true, 0);

        vm.prank(address(mockPoolManager));
        hook.afterSwap(address(0xDAD), key, params, toBalanceDelta(0, 0), "");

        assertEq(hook.observationCount(poolId), 0, "No observation for zero swap");
        assertEq(hook.accruedFees0(poolId), 0, "No fees for zero swap");
    }

    function test_afterSwap_noObservationWhenZeroAmountOut() public {
        PoolKey memory key = _testPoolKey();
        SwapParams memory params = _swapParams(true, 1000);

        vm.prank(address(mockPoolManager));
        hook.afterSwap(address(0xDAD), key, params, toBalanceDelta(1000, 0), "");

        assertEq(hook.observationCount(poolId), 0, "No observation when amountOut is zero");
        assertEq(hook.accruedFees0(poolId), 3, "Fee should still accrue");
    }

    function test_afterSwap_identicalTimestamp_foldsInPlace() public {
        // Two swaps in the same block: no zero-elapsed observation is stored — the newest
        // slot's terminal tick is refreshed in place, keeping every stored delta positive.
        _setTick(10);
        _doSwap(true, 1000, 500);

        _setTick(20);
        _doSwap(true, 1000, 500); // same block.timestamp

        assertEq(hook.observationCount(poolId), 1, "same-timestamp sample must not consume a slot");
        (uint32 ts, int56 cum, int24 tick,) = hook.observationAt(poolId, 0);
        assertEq(ts, uint32(block.timestamp));
        assertEq(cum, 0, "cumulative unchanged by zero-elapsed fold");
        assertEq(tick, 20, "terminal tick refreshed to the latest swap's spot tick");
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //  TIME-WEIGHTED TWAP READS
    // ═══════════════════════════════════════════════════════════════════════════

    function test_getCurrentTwap_knownMultiObservationSequence() public {
        // Deterministic schedule (tick, holding duration):
        //   t=t0     : swap -> tick  1000 recorded (cumulative 0)
        //   t=t0+30  : swap -> tick -2000 recorded, cum = 1000*30            =    30_000
        //   t=t0+90  : swap -> tick  3000 recorded, cum = 30_000 + (-2000)*60 =   -90_000
        //   [now]    : +10 more seconds at tick 3000 (extrapolated), cum now  =   -60_000
        // Window = 100s (full, t=t0): avgTick = (-60_000 - 0) / 100 = -600 (exact)
        _setTick(1000);
        _doSwap(true, 1e9, 1e9); // t0

        _advance(30);
        _setTick(-2000);
        _doSwap(true, 1e9, 1e9);

        _advance(60);
        _setTick(3000);
        _doSwap(true, 1e9, 1e9);

        _advance(10);

        (, int56 cumLatest, int24 latestTick) = hook.getLatestObservation(poolId);
        assertEq(cumLatest, int56(-90_000), "stored cumulative after third observation");
        assertEq(latestTick, 3000, "latest terminal tick");

        int24 avgTick = hook.getTwapTick(poolId, 100);
        assertEq(avgTick, -600, "exact time-weighted tick: (cumNow - 0) / 100");

        // Sub-window [now-90, now] spans the -2000 and +3000 spans only:
        //   cum(now)    = -60_000
        //   cum(now-90) = interp at t0+10: 0 + 1000*10 = 10_000
        //   avg = (-60_000 - 10_000) / 90 = -70_000/90 -> floor = -778
        //   (truncation toward zero would give the biased -777).
        int24 avgSub = hook.getTwapTick(poolId, 90);
        assertEq(avgSub, -778, "negative avg tick must round DOWN (floor), not toward zero");

        // Price conversion is deterministic from the avg tick.
        uint256 price = hook.getCurrentTwap(poolId, 100);
        assertEq(price, _priceX18AtTick(-600), "price must equal TickMath conversion of the avg tick");
    }

    function test_getCurrentTwap_constantTick_equalsSpotPrice() public {
        _setTick(6000);
        _doSwap(true, 1e9, 1e9);
        _advance(50);
        _doSwap(true, 1e9, 1e9);
        _advance(50);

        uint256 price = hook.getCurrentTwap(poolId, 100);
        assertEq(price, _priceX18AtTick(6000), "constant tick window must resolve to the spot price");
    }

    function test_observe_returnsCumulatives() public {
        _setTick(100);
        _doSwap(true, 1e9, 1e9);
        _advance(40);
        _setTick(200);
        _doSwap(true, 1e9, 1e9);
        _advance(10);

        uint32[] memory agos = new uint32[](3);
        agos[0] = 0; // now: 100*40 + 200*10 = 6000
        agos[1] = 10; // at second obs: cum = 4000
        agos[2] = 50; // at first obs: cum = 0
        int56[] memory cums = hook.observe(poolId, agos);
        assertEq(cums[0], int56(6000));
        assertEq(cums[1], int56(4000));
        assertEq(cums[2], int56(0));
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //  TWAP EDGE CASES & GUARDS
    // ═══════════════════════════════════════════════════════════════════════════

    function test_getCurrentTwap_revertsNoObservations() public {
        vm.expectRevert(Errors.InsufficientObservations.selector);
        hook.getCurrentTwap(bytes32("ghost"), 10);
    }

    function test_getCurrentTwap_revertsSingleObservation() public {
        _doSwap(true, 1000, 500);
        _advance(10);
        vm.expectRevert(Errors.InsufficientObservations.selector);
        hook.getCurrentTwap(poolId, 10);
    }

    function test_getCurrentTwap_revertsZeroSeconds() public {
        _doSwap(true, 1000, 500);
        _advance(10);
        _doSwap(true, 1000, 500);
        vm.expectRevert(Errors.InsufficientElapsedTime.selector);
        hook.getCurrentTwap(poolId, 0);
    }

    function test_getCurrentTwap_revertsWindowOlderThanBuffer() public {
        _doSwap(true, 1000, 500);
        _advance(10);
        _doSwap(true, 1000, 500);
        _advance(10);

        // Window start predates the oldest retained observation.
        vm.expectRevert(Errors.InsufficientElapsedTime.selector);
        hook.getCurrentTwap(poolId, 1_000_000);
    }

    function test_observe_revertsNoObservations() public {
        uint32[] memory agos = new uint32[](1);
        agos[0] = 0;
        vm.expectRevert(Errors.InsufficientObservations.selector);
        hook.observe(bytes32("ghost"), agos);
    }

    function test_getCurrentTwap_circularBufferOverflow() public {
        _setTick(777);
        for (uint256 i = 0; i < 1025; i++) {
            _advance(1);
            _doSwap(true, 1000, 500);
        }
        assertEq(hook.observationCount(poolId), 1024, "Count capped at 1024");

        // Ring is saturated: a 1000s window resolves across the wraparound.
        int24 avgTick = hook.getTwapTick(poolId, 1000);
        assertEq(avgTick, 777, "constant tick across wraparound must return that tick");
        assertEq(hook.getCurrentTwap(poolId, 1000), _priceX18AtTick(777));

        // Window whose start lands on the overwritten first observation reverts
        // (first two observations were recycled out of the 1024-slot ring).
        vm.expectRevert(Errors.InsufficientElapsedTime.selector);
        hook.getTwapTick(poolId, 1025);
    }

    function test_observationAt_revertsOutOfBounds() public {
        vm.expectRevert(Errors.PoolIndexOutOfBounds.selector);
        hook.observationAt(poolId, 1024);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //  GET LATEST OBSERVATION
    // ═══════════════════════════════════════════════════════════════════════════

    function test_getLatestObservation_noObservations() public view {
        (uint32 timestamp, int56 tickCumulative, int24 tick) = hook.getLatestObservation(bytes32("nonexistent"));
        assertEq(timestamp, 0);
        assertEq(tickCumulative, 0);
        assertEq(tick, 0);
    }

    function test_getLatestObservation_afterSwap() public {
        _setTick(456);
        _doSwap(true, 1000, 500);

        (uint32 timestamp, int56 tickCumulative, int24 tick) = hook.getLatestObservation(poolId);

        assertEq(timestamp, uint32(block.timestamp), "Timestamp should match block.timestamp");
        assertEq(tickCumulative, 0, "Cumulative must be 0 after the first observation");
        assertEq(tick, 456, "Latest tick should match pool state");
    }

    function test_getLatestObservation_afterMultipleSwaps() public {
        _setTick(100);
        _doSwap(true, 1000, 500);

        _advance(10);
        _setTick(250);
        _doSwap(true, 2000, 500);

        (, int56 tickCumulative, int24 tick) = hook.getLatestObservation(poolId);

        assertEq(tick, 250, "Latest tick should match the second swap's pool state");
        assertEq(tickCumulative, int56(1000), "Cumulative = 100 tick * 10 seconds");
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //  FUZZ TESTS
    // ═══════════════════════════════════════════════════════════════════════════

    function testFuzz_setProtocolFee_withinBounds(uint24 fee) public {
        fee = uint24(bound(fee, 0, 1000));
        hook.setProtocolFee(fee);
        assertEq(hook.protocolFeeBps(), fee);
    }

    function testFuzz_setProtocolFee_outOfBoundsReverts(uint24 fee) public {
        fee = uint24(bound(fee, 1001, type(uint24).max));
        vm.expectRevert(AetherHook.FeeTooHigh.selector);
        hook.setProtocolFee(fee);
    }

    function testFuzz_afterSwap_feeAccrual(uint128 amountIn, uint128 amountOut) public {
        amountIn = uint128(bound(amountIn, 1, 1e18));
        amountOut = uint128(bound(amountOut, 1, 1e18));

        _doSwap(true, amountIn, amountOut);

        uint256 expectedFee = (uint256(amountIn) * PROTOCOL_FEE_BPS) / 10_000;
        assertEq(hook.accruedFees0(poolId), expectedFee, "Fee calculation should be exact");
    }

    /// @notice Two-tick time-weighting: the average tick over [t0, t1] must weight each
    ///         terminal tick by its elapsed holding time, independent of trade size.
    function testFuzz_twoTickTimeWeighting(int24 tick0, int24 tick1, uint32 hold0, uint32 hold1) public {
        tick0 = int24(bound(tick0, -100_000, 100_000));
        tick1 = int24(bound(tick1, -100_000, 100_000));
        hold0 = uint32(bound(hold0, 1, 1 days));
        hold1 = uint32(bound(hold1, 1, 1 days));

        _setTick(tick0);
        _doSwap(true, 1e9, 1e9);

        _advance(uint256(hold0));
        _setTick(tick1);
        _doSwap(true, 1e9, 1e9);

        _advance(uint256(hold1));

        uint32 window = hold0 + hold1;
        int256 numerator =
            int256(tick0) * int256(uint256(hold0)) + int256(tick1) * int256(uint256(hold1));
        int256 denom = int256(uint256(window));
        // The hook floors negative averages (rounds toward negative infinity); mirror it here
        // instead of Solidity's default truncation toward zero.
        int256 expected = numerator / denom;
        if (numerator < 0 && numerator % denom != 0) expected -= 1;

        int24 avgTick = hook.getTwapTick(poolId, window);
        assertEq(int256(avgTick), expected, "TWAP tick must be elapsed-time weighted");

        assertEq(hook.getCurrentTwap(poolId, window), _priceX18AtTick(avgTick), "price conversion must agree");
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //  OBSERVATION EVENTS
    // ═══════════════════════════════════════════════════════════════════════════

    function test_afterSwap_emitsObservationRecorded() public {
        _setTick(900);
        PoolKey memory key = _testPoolKey();
        SwapParams memory params = _swapParams(true, 1000);
        BalanceDelta delta = toBalanceDelta(1000, -500);

        vm.expectEmit(true, true, true, true);
        emit AetherHook.ObservationRecorded(poolId, uint32(block.timestamp), int56(0), int24(900));

        vm.prank(address(mockPoolManager));
        hook.afterSwap(address(0xDAD), key, params, delta, "");
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //  MAX_PROTOCOL_FEE_BPS constant
    // ═══════════════════════════════════════════════════════════════════════════

    function test_maxProtocolFeeBps() public view {
        assertEq(hook.MAX_PROTOCOL_FEE_BPS(), 1000, "Max fee should be 1000 bps");
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //  HELPERS
    // ═══════════════════════════════════════════════════════════════════════════

    function _testPoolKey() internal pure returns (PoolKey memory) {
        return PoolKey({
            currency0: Currency.wrap(TOKEN0),
            currency1: Currency.wrap(TOKEN1),
            fee: 3000,
            tickSpacing: 60,
            hooks: IHooks(address(0))
        });
    }

    function _swapParams(bool zeroForOne, int256 amountSpecified) internal pure returns (SwapParams memory) {
        return SwapParams({zeroForOne: zeroForOne, amountSpecified: amountSpecified, sqrtPriceLimitX96: 0});
    }

    function _modifyLiqParams() internal pure returns (ModifyLiquidityParams memory) {
        return ModifyLiquidityParams({tickLower: -887220, tickUpper: 887220, liquidityDelta: 1e18, salt: 0});
    }

    /// @dev Set the mock PoolManager's terminal spot tick (with consistent sqrtPriceX96)
    function _setTick(int24 tick) internal {
        mockPoolManager.setSlot0(TickMath.getSqrtPriceAtTick(tick), tick);
    }

    /// @dev Advance time by `dt` seconds using the test-owned absolute clock.
    function _advance(uint256 dt) internal {
        _clock += dt;
        vm.warp(_clock);
    }

    /// @dev 1e18-scaled price at a tick — reference implementation matching the hook:
    ///      priceX96 = sqrtP^2 / 2^96 (FullMath handles the 512-bit product), then to 1e18.
    function _priceX18AtTick(int24 tick) internal pure returns (uint256) {
        uint256 p = uint256(TickMath.getSqrtPriceAtTick(tick));
        uint256 priceX96 = FullMath.mulDiv(p, p, FixedPoint96.Q96);
        return FullMath.mulDiv(priceX96, 1e18, FixedPoint96.Q96);
    }

    /// @dev Execute a swap through the hook (called by mock PoolManager)
    function _doSwap(bool zeroForOne, uint128 amountIn, uint128 amountOut) internal {
        PoolKey memory key = _testPoolKey();
        SwapParams memory params = _swapParams(zeroForOne, int256(int128(amountIn)));
        BalanceDelta delta;

        if (zeroForOne) {
            delta = toBalanceDelta(int128(amountIn), -int128(amountOut));
        } else {
            delta = toBalanceDelta(-int128(amountOut), int128(amountIn));
        }

        vm.prank(address(mockPoolManager));
        hook.afterSwap(address(0xDAD), key, params, delta, "");
    }
}
