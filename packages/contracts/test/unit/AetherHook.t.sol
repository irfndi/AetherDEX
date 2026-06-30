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

/// @title AetherHook Unit Tests
/// @notice Tests for AetherHook — protocol fee capture, TWAP, access control
/// @dev Hook address must have bits 6 and 7 set (BEFORE_SWAP_FLAG | AFTER_SWAP_FLAG).
///      We deploy via `deployCodeTo` to a controlled address, then cast.
contract AetherHookTest is Test {
    AetherHook hook;

    // Target address with bits 6 (0x40) and 7 (0x80) set → lowest byte must be 0xC0+
    address constant HOOK_ADDR = address(uint160(0x80C0));
    address constant TREASURY = address(0xCAFE);
    address constant NOT_OWNER = address(0xBAD);
    uint24 constant PROTOCOL_FEE_BPS = 30; // 0.30%
    address constant MOCK_POOL_MANAGER = address(0xA11CE);

    // Tokens for PoolKey construction
    address constant TOKEN0 = address(0xA000);
    address constant TOKEN1 = address(0xB000);

    // Pre-computed poolId from the test PoolKey
    bytes32 poolId;

    function setUp() public {
        // Deploy AetherHook at an address with correct hook permission bits
        // deployCodeTo returns void; the contract lives at HOOK_ADDR after the call
        deployCodeTo(
            "AetherHook.sol:AetherHook",
            abi.encode(IPoolManager(MOCK_POOL_MANAGER), TREASURY, PROTOCOL_FEE_BPS, address(this)),
            HOOK_ADDR
        );
        hook = AetherHook(HOOK_ADDR);
        assertEq(address(hook), HOOK_ADDR, "Hook must be deployed at controlled address");

        // Compute poolId from the same PoolKey used in tests
        PoolKey memory key = _testPoolKey();
        poolId = keccak256(abi.encode(key));
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //  CONSTRUCTOR
    // ═══════════════════════════════════════════════════════════════════════════

    function test_constructor_setsCorrectValues() public view {
        assertEq(address(hook.poolManager()), MOCK_POOL_MANAGER);
        assertEq(hook.treasury(), TREASURY);
        assertEq(hook.protocolFeeBps(), PROTOCOL_FEE_BPS);
        assertEq(hook.owner(), address(this));
    }

    function test_constructor_revertsZeroTreasury() public {
        vm.expectRevert(Errors.ZeroAddress.selector);
        deployCodeTo(
            "AetherHook.sol:AetherHook",
            abi.encode(IPoolManager(MOCK_POOL_MANAGER), address(0), PROTOCOL_FEE_BPS, address(this)),
            address(uint160(0x80C1))
        );
    }

    function test_constructor_revertsFeeTooHigh() public {
        vm.expectRevert(AetherHook.FeeTooHigh.selector);
        deployCodeTo(
            "AetherHook.sol:AetherHook",
            abi.encode(IPoolManager(MOCK_POOL_MANAGER), TREASURY, 1001, address(this)),
            address(uint160(0x80C2))
        );
    }

    function test_constructor_acceptsMaxFee() public {
        // Deploy at address with valid hook bits (lower 14 bits = 0xC0)
        deployCodeTo(
            "AetherHook.sol:AetherHook",
            abi.encode(IPoolManager(MOCK_POOL_MANAGER), TREASURY, 1000, address(this)),
            address(uint160(0x200C0))
        );
        assertTrue(true);
    }

    function test_constructor_acceptsZeroFee() public {
        deployCodeTo(
            "AetherHook.sol:AetherHook",
            abi.encode(IPoolManager(MOCK_POOL_MANAGER), TREASURY, 0, address(this)),
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

        vm.prank(MOCK_POOL_MANAGER);
        (bytes4 selector, BeforeSwapDelta delta, uint24 fee) = hook.beforeSwap(
            address(0xDAD), key, params, ""
        );

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

        vm.prank(MOCK_POOL_MANAGER);
        (bytes4 selector, int128 deltaAmt) = hook.afterSwap(address(0xDAD), key, params, delta, "");

        assertEq(selector, hook.afterSwap.selector);
        assertEq(deltaAmt, 0, "afterSwap should return zero delta");
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //  AFTER SWAP — TWAP OBSERVATIONS
    // ═══════════════════════════════════════════════════════════════════════════

    function test_afterSwap_recordsObservation() public {
        _doSwap(true, 1000, 500);
        assertEq(hook.observationCount(poolId), 1, "Should have 1 observation");
        assertGt(hook.observationIndex(poolId), 0, "Index should advance");
    }

    function test_afterSwap_multipleSwaps_accumulateObservations() public {
        _doSwap(true, 1000, 500);
        _doSwap(true, 2000, 800);
        _doSwap(true, 1500, 600);
        assertEq(hook.observationCount(poolId), 3, "Should have 3 observations");
    }

    function test_afterSwap_noObservationWhenZeroAmountIn() public {
        PoolKey memory key = _testPoolKey();
        SwapParams memory params = _swapParams(true, 0);

        vm.prank(MOCK_POOL_MANAGER);
        hook.afterSwap(address(0xDAD), key, params, toBalanceDelta(0, 0), "");

        assertEq(hook.observationCount(poolId), 0, "No observation for zero swap");
        assertEq(hook.accruedFees0(poolId), 0, "No fees for zero swap");
    }

    function test_afterSwap_noObservationWhenZeroAmountOut() public {
        PoolKey memory key = _testPoolKey();
        SwapParams memory params = _swapParams(true, 1000);

        vm.prank(MOCK_POOL_MANAGER);
        hook.afterSwap(address(0xDAD), key, params, toBalanceDelta(1000, 0), "");

        assertEq(hook.observationCount(poolId), 0, "No observation when amountOut is zero");
        assertEq(hook.accruedFees0(poolId), 3, "Fee should still accrue");
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //  GET CURRENT TWAP
    // ═══════════════════════════════════════════════════════════════════════════

    function test_getCurrentTwap_noObservations() public view {
        uint256 twap = hook.getCurrentTwap(bytes32("nonexistent"), 5);
        assertEq(twap, 0, "TWAP should be 0 for nonexistent pool");
    }

    function test_getCurrentTwap_afterOneSwap() public {
        _doSwap(true, 1000, 500); // price = 2e18

        uint256 twap = hook.getCurrentTwap(poolId, 1);
        assertEq(twap, 2e18, "TWAP should be 2e18 after one swap");
    }

    function test_getCurrentTwap_afterMultipleSwaps_lookbackOne() public {
        _doSwap(true, 1000, 500); // price = 2e18, cumulative = 2e18
        _doSwap(true, 2000, 1000); // price = 2e18, cumulative = 4e18

        uint256 twap = hook.getCurrentTwap(poolId, 1);
        // count=2, lookback=1, count > lookback → previous from index 1
        assertEq(twap, 2e18, "TWAP with lookback=1 should show last observation delta");
    }

    function test_getCurrentTwap_lookbackExceedsCount() public {
        _doSwap(true, 1000, 500);
        uint256 twap = hook.getCurrentTwap(poolId, 100);
        assertEq(twap, 2e18, "Lookback exceeding count should clamp to count");
    }

    function test_getCurrentTwap_lookbackZero() public {
        _doSwap(true, 1000, 500);
        uint256 twap = hook.getCurrentTwap(poolId, 0);
        assertEq(twap, 2e18, "Lookback 0 should clamp to 1");
    }

    function test_getCurrentTwap_circularBufferOverflow() public {
        for (uint256 i = 0; i < 1025; i++) {
            vm.warp(block.timestamp + 1);
            _doSwap(true, 1000, 500);
        }
        assertEq(hook.observationCount(poolId), 1024, "Count capped at 1024");
        uint256 twap = hook.getCurrentTwap(poolId, 1);
        assertGt(twap, 0, "TWAP should still work after buffer overflow");
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //  GET LATEST OBSERVATION
    // ═══════════════════════════════════════════════════════════════════════════

    function test_getLatestObservation_noObservations() public view {
        (uint32 timestamp, uint256 priceCumulative, uint256 priceLatest) =
            hook.getLatestObservation(bytes32("nonexistent"));
        assertEq(timestamp, 0);
        assertEq(priceCumulative, 0);
        assertEq(priceLatest, 0);
    }

    function test_getLatestObservation_afterSwap() public {
        _doSwap(true, 1000, 500);

        (uint32 timestamp, uint256 priceCumulative, uint256 priceLatest) = hook.getLatestObservation(poolId);

        assertEq(timestamp, uint32(block.timestamp), "Timestamp should match block.timestamp");
        assertEq(priceLatest, 2e18, "Latest price should be 2e18");
        assertEq(priceCumulative, 2e18, "Cumulative should be 2e18 after first swap");
    }

    function test_getLatestObservation_afterMultipleSwaps() public {
        _doSwap(true, 1000, 500); // price = 2e18

        vm.warp(block.timestamp + 10);
        _doSwap(true, 2000, 500); // price = 4e18, cumulative = 6e18

        (, uint256 priceCumulative, uint256 priceLatest) = hook.getLatestObservation(poolId);

        assertEq(priceLatest, 4e18, "Latest price should be 4e18");
        assertEq(priceCumulative, 6e18, "Cumulative should be 2e18 + 4e18 = 6e18");
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

    // ═══════════════════════════════════════════════════════════════════════════
    //  OBSERVATION EVENTS
    // ═══════════════════════════════════════════════════════════════════════════

    function test_afterSwap_emitsObservationRecorded() public {
        PoolKey memory key = _testPoolKey();
        SwapParams memory params = _swapParams(true, 1000);
        BalanceDelta delta = toBalanceDelta(1000, -500);

        vm.expectEmit(true, true, true, true);
        emit AetherHook.ObservationRecorded(poolId, uint32(block.timestamp), 2e18, 2e18);

        vm.prank(MOCK_POOL_MANAGER);
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

    function _swapParams(bool zeroForOne, int256 amountSpecified)
        internal
        pure
        returns (SwapParams memory)
    {
        return SwapParams({zeroForOne: zeroForOne, amountSpecified: amountSpecified, sqrtPriceLimitX96: 0});
    }

    function _modifyLiqParams() internal pure returns (ModifyLiquidityParams memory) {
        return ModifyLiquidityParams({tickLower: -887220, tickUpper: 887220, liquidityDelta: 1e18, salt: 0});
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

        vm.prank(MOCK_POOL_MANAGER);
        hook.afterSwap(address(0xDAD), key, params, delta, "");
    }
}
