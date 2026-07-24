// SPDX-License-Identifier: MIT
pragma solidity ^0.8.31;

import "forge-std/Test.sol";
import {AetherRouter} from "src/router/AetherRouter.sol";
import {AetherFactory} from "src/factory/AetherFactory.sol";
import {IAetherFactory} from "src/interfaces/IAetherFactory.sol";
import {Errors} from "src/lib/Errors.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency, CurrencyLibrary} from "@uniswap/v4-core/src/types/Currency.sol";
import {BalanceDelta, toBalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {IUnlockCallback} from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {SwapParams, ModifyLiquidityParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @title AetherRouter Unit Tests
/// @notice Tests for AetherRouter — constructor, access control, full swap/liquidity paths
contract AetherRouterTest is Test {
    using CurrencyLibrary for Currency;

    AetherRouter router;
    AetherFactory factory;
    MockPoolManager mockPM;
    MockERC20 token0;
    MockERC20 token1;

    address user = address(0xDAD);
    address constant HOOK = address(uint160(0x100C0)); // valid hook bits (lower 14 bits = 0xC0)
    uint160 constant INITIAL_SQRT_PRICE = 79228162514264337593543950336;

    function setUp() public {
        mockPM = new MockPoolManager();
        token0 = new MockERC20("Token0", "T0");
        token1 = new MockERC20("Token1", "T1");

        factory = new AetherFactory(IPoolManager(address(mockPM)), IHooks(HOOK), address(this));
        router = new AetherRouter(IPoolManager(address(mockPM)), IAetherFactory(address(factory)), address(this));

        // Fund user and approve router
        token0.mint(user, 1_000_000 ether);
        token1.mint(user, 1_000_000 ether);

        vm.prank(user);
        token0.approve(address(router), type(uint256).max);
        vm.prank(user);
        token1.approve(address(router), type(uint256).max);

        // Fund mockPM with output tokens for take()
        token0.mint(address(mockPM), 1_000_000 ether);
        token1.mint(address(mockPM), 1_000_000 ether);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //  CONSTRUCTOR
    // ═══════════════════════════════════════════════════════════════════════════

    function test_constructor_setsCorrectValues() public view {
        assertEq(address(router.poolManager()), address(mockPM));
        assertEq(address(router.factory()), address(factory));
        assertEq(router.owner(), address(this));
    }

    function test_constructor_revertsZeroPoolManager() public {
        vm.expectRevert(Errors.ZeroAddress.selector);
        new AetherRouter(IPoolManager(address(0)), IAetherFactory(address(factory)), address(this));
    }

    function test_constructor_revertsZeroFactory() public {
        vm.expectRevert(Errors.ZeroAddress.selector);
        new AetherRouter(IPoolManager(address(mockPM)), IAetherFactory(address(0)), address(this));
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //  UNLOCK CALLBACK — ACCESS CONTROL
    // ═══════════════════════════════════════════════════════════════════════════

    function test_unlockCallback_revertsIfNotPoolManager() public {
        vm.expectRevert(Errors.Unauthorized.selector);
        router.unlockCallback(abi.encode(uint8(0)));
    }

    function test_unlockCallback_revertsInvalidAction() public {
        vm.prank(address(mockPM));
        // Invalid enum value causes abi.decode panic before reaching InvalidPath
        vm.expectRevert();
        router.unlockCallback(abi.encode(uint8(99), bytes("")));
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //  SWAP EXACT IN — DEADLINE & AMOUNT VALIDATION
    // ═══════════════════════════════════════════════════════════════════════════

    function test_swapExactTokensForTokens_revertsDeadlineExpired() public {
        vm.warp(100);
        AetherRouter.SwapExactInParams memory params = _swapExactInParams(block.timestamp + 1);
        vm.warp(200);

        vm.expectRevert(Errors.DeadlineExpired.selector);
        vm.prank(user);
        router.swapExactTokensForTokens(params);
    }

    function test_swapExactTokensForTokens_revertsZeroAmount() public {
        vm.warp(100);
        AetherRouter.SwapExactInParams memory params = _swapExactInParams(block.timestamp + 100);
        params.amountIn = 0;

        vm.expectRevert(Errors.ZeroAmount.selector);
        vm.prank(user);
        router.swapExactTokensForTokens(params);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //  SWAP EXACT OUT — DEADLINE & AMOUNT VALIDATION
    // ═══════════════════════════════════════════════════════════════════════════

    function test_swapExactTokensForTokensOut_revertsDeadlineExpired() public {
        vm.warp(100);
        AetherRouter.SwapExactOutParams memory params = _swapExactOutParams(block.timestamp + 1);
        vm.warp(200);

        vm.expectRevert(Errors.DeadlineExpired.selector);
        vm.prank(user);
        router.swapExactTokensForTokensOut(params);
    }

    function test_swapExactTokensForTokensOut_revertsZeroAmount() public {
        vm.warp(100);
        AetherRouter.SwapExactOutParams memory params = _swapExactOutParams(block.timestamp + 100);
        params.amountOut = 0;

        vm.expectRevert(Errors.ZeroAmount.selector);
        vm.prank(user);
        router.swapExactTokensForTokensOut(params);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //  ADD LIQUIDITY — DEADLINE VALIDATION
    // ═══════════════════════════════════════════════════════════════════════════

    function test_addLiquidity_revertsDeadlineExpired() public {
        vm.warp(100);
        PoolKey memory key = _testPoolKey();
        vm.warp(200);

        vm.expectRevert(Errors.DeadlineExpired.selector);
        vm.prank(user);
        router.addLiquidity(key, _modifyLiqParams(), 1 ether, 1 ether, 100);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //  REMOVE LIQUIDITY — DEADLINE VALIDATION
    // ═══════════════════════════════════════════════════════════════════════════

    function test_removeLiquidity_revertsDeadlineExpired() public {
        vm.warp(100);
        PoolKey memory key = _testPoolKey();
        vm.warp(200);

        vm.expectRevert(Errors.DeadlineExpired.selector);
        vm.prank(user);
        router.removeLiquidity(key, _modifyLiqParams(), 0, 0, 100);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //  FULL SWAP FLOW — SWAP EXACT IN (zeroForOne)
    // ═══════════════════════════════════════════════════════════════════════════

    function test_swapExactTokensForTokens_zeroForOne_succeeds() public {
        // Router reads delta.amount1() directly (no negation) for output amount
        // So mock returns positive amount1 for the received amount
        mockPM.setSwapDelta(toBalanceDelta(-int128(1 ether), int128(0.9 ether)));

        uint256 userBal1Before = token1.balanceOf(user);

        vm.warp(1);
        vm.prank(user);
        uint256 amountOut = router.swapExactTokensForTokens(
            AetherRouter.SwapExactInParams({
                poolKey: _testPoolKey(),
                zeroForOne: true,
                amountIn: 1 ether,
                minAmountOut: uint128(0.8 ether),
                deadline: block.timestamp + 100,
                hookData: ""
            })
        );

        assertEq(amountOut, 0.9 ether, "Should receive 0.9 token1");
        assertEq(token1.balanceOf(user), userBal1Before + 0.9 ether, "User token1 balance should increase");
    }

    function test_swapExactTokensForTokens_zeroForOne_slippageReverts() public {
        mockPM.setSwapDelta(toBalanceDelta(-int128(1 ether), int128(0.5 ether)));

        vm.warp(1);
        vm.prank(user);
        vm.expectRevert();
        router.swapExactTokensForTokens(
            AetherRouter.SwapExactInParams({
                poolKey: _testPoolKey(),
                zeroForOne: true,
                amountIn: 1 ether,
                minAmountOut: uint128(0.8 ether),
                deadline: block.timestamp + 100,
                hookData: ""
            })
        );
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //  FULL SWAP FLOW — SWAP EXACT IN (oneForZero)
    // ═══════════════════════════════════════════════════════════════════════════

    function test_swapExactTokensForTokens_oneForZero_succeeds() public {
        mockPM.setSwapDelta(toBalanceDelta(int128(0.9 ether), -int128(1 ether)));

        uint256 userBal0Before = token0.balanceOf(user);

        vm.warp(1);
        vm.prank(user);
        uint256 amountOut = router.swapExactTokensForTokens(
            AetherRouter.SwapExactInParams({
                poolKey: _testPoolKey(),
                zeroForOne: false,
                amountIn: 1 ether,
                minAmountOut: uint128(0.8 ether),
                deadline: block.timestamp + 100,
                hookData: ""
            })
        );

        assertEq(amountOut, 0.9 ether, "Should receive 0.9 token0");
        assertEq(token0.balanceOf(user), userBal0Before + 0.9 ether, "User token0 balance should increase");
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //  FULL SWAP FLOW — SWAP EXACT OUT (zeroForOne)
    // ═══════════════════════════════════════════════════════════════════════════

    function test_swapExactTokensForTokensOut_zeroForOne_succeeds() public {
        // Router: amountIn = uint256(-int256(delta.amount0()))
        // So delta.amount0 must be negative for the user paying
        mockPM.setSwapDelta(toBalanceDelta(-int128(1.1 ether), int128(0.9 ether)));

        uint256 userBal0Before = token0.balanceOf(user);

        vm.warp(1);
        vm.prank(user);
        uint256 amountIn = router.swapExactTokensForTokensOut(
            AetherRouter.SwapExactOutParams({
                poolKey: _testPoolKey(),
                zeroForOne: true,
                amountOut: 0.9 ether,
                maxAmountIn: uint128(1.2 ether),
                deadline: block.timestamp + 100,
                hookData: ""
            })
        );

        assertEq(amountIn, 1.1 ether, "Should consume 1.1 token0");
        assertEq(token0.balanceOf(user), userBal0Before - 1.1 ether, "User should spend 1.1 token0");
    }

    function test_swapExactTokensForTokensOut_oneForZero_succeeds() public {
        // Router: amountIn = uint256(-int256(delta.amount1()))
        // So delta.amount1 must be negative for the user paying
        mockPM.setSwapDelta(toBalanceDelta(int128(0.9 ether), -int128(1.1 ether)));

        vm.warp(1);
        vm.prank(user);
        uint256 amountIn = router.swapExactTokensForTokensOut(
            AetherRouter.SwapExactOutParams({
                poolKey: _testPoolKey(),
                zeroForOne: false,
                amountOut: 0.9 ether,
                maxAmountIn: uint128(1.2 ether),
                deadline: block.timestamp + 100,
                hookData: ""
            })
        );

        assertEq(amountIn, 1.1 ether, "Should consume 1.1 token1");
    }

    function test_swapExactTokensForTokensOut_slippageReverts() public {
        // amountIn = uint256(-int256(-1.5e18)) = 1.5 ether > maxAmountIn = 1.2 ether
        mockPM.setSwapDelta(toBalanceDelta(-int128(1.5 ether), int128(0.9 ether)));

        vm.warp(1);
        vm.prank(user);
        vm.expectRevert();
        router.swapExactTokensForTokensOut(
            AetherRouter.SwapExactOutParams({
                poolKey: _testPoolKey(),
                zeroForOne: true,
                amountOut: 0.9 ether,
                maxAmountIn: uint128(1.2 ether),
                deadline: block.timestamp + 100,
                hookData: ""
            })
        );
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //  FULL SWAP FLOW — SWAP EMITS EVENT
    // ═══════════════════════════════════════════════════════════════════════════

    function test_swapExactTokensForTokens_emitsEvent() public {
        mockPM.setSwapDelta(toBalanceDelta(-int128(1 ether), int128(0.9 ether)));

        vm.warp(1);
        vm.prank(user);
        vm.expectEmit(true, true, true, true);
        emit AetherRouter.Swap(user, address(token0), address(token1), 1 ether, 0.9 ether);
        router.swapExactTokensForTokens(
            AetherRouter.SwapExactInParams({
                poolKey: _testPoolKey(),
                zeroForOne: true,
                amountIn: 1 ether,
                minAmountOut: 0,
                deadline: block.timestamp + 100,
                hookData: ""
            })
        );
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //  ADD LIQUIDITY — FULL FLOW
    // ═══════════════════════════════════════════════════════════════════════════

    function test_addLiquidity_succeeds() public {
        mockPM.setModifyLiquidityDelta(toBalanceDelta(-int128(0.5 ether), -int128(0.5 ether)));

        vm.warp(1);
        vm.prank(user);
        router.addLiquidity(
            _testPoolKey(),
            _modifyLiqParams(),
            0.6 ether,
            0.6 ether,
            block.timestamp + 100
        );

        assertEq(token0.balanceOf(user), 1_000_000 ether - 0.5 ether, "User should spend 0.5 token0");
        assertEq(token1.balanceOf(user), 1_000_000 ether - 0.5 ether, "User should spend 0.5 token1");
    }

    function test_addLiquidity_emitsEvent() public {
        mockPM.setModifyLiquidityDelta(toBalanceDelta(-int128(0.5 ether), -int128(0.5 ether)));

        vm.warp(1);
        vm.prank(user);
        PoolKey memory key = _testPoolKey();
        vm.expectEmit(true, true, true, true);
        emit AetherRouter.LiquidityAdded(user, keccak256(abi.encode(key)), 0.5 ether, 0.5 ether);
        router.addLiquidity(key, _modifyLiqParams(), 0.6 ether, 0.6 ether, block.timestamp + 100);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //  REMOVE LIQUIDITY — FULL FLOW
    // ═══════════════════════════════════════════════════════════════════════════

    function test_removeLiquidity_succeeds() public {
        mockPM.setModifyLiquidityDelta(toBalanceDelta(-int128(0.5 ether), -int128(0.5 ether)));
        vm.prank(user);
        router.addLiquidity(_testPoolKey(), _modifyLiqParams(), 0.6 ether, 0.6 ether, block.timestamp + 100);
        mockPM.setModifyLiquidityDelta(toBalanceDelta(int128(0.5 ether), int128(0.5 ether)));

        uint256 userBal0Before = token0.balanceOf(user);
        uint256 userBal1Before = token1.balanceOf(user);

        vm.warp(1);
        vm.prank(user);
        router.removeLiquidity(
            _testPoolKey(),
            _removeLiqParams(),
            0,
            0,
            block.timestamp + 100
        );

        assertEq(token0.balanceOf(user), userBal0Before + 0.5 ether, "User should receive 0.5 token0");
        assertEq(token1.balanceOf(user), userBal1Before + 0.5 ether, "User should receive 0.5 token1");
    }

    function test_removeLiquidity_slippageReverts() public {
        mockPM.setModifyLiquidityDelta(toBalanceDelta(-int128(0.5 ether), -int128(0.5 ether)));
        vm.prank(user);
        router.addLiquidity(_testPoolKey(), _modifyLiqParams(), 0.6 ether, 0.6 ether, block.timestamp + 100);
        mockPM.setModifyLiquidityDelta(toBalanceDelta(int128(0.3 ether), int128(0.3 ether)));

        vm.warp(1);
        vm.prank(user);
        vm.expectRevert();
        router.removeLiquidity(
            _testPoolKey(),
            _removeLiqParams(),
            uint256(0.5 ether),
            0,
            block.timestamp + 100
        );
    }

    function test_removeLiquidity_emitsEvent() public {
        mockPM.setModifyLiquidityDelta(toBalanceDelta(-int128(0.5 ether), -int128(0.5 ether)));
        vm.prank(user);
        router.addLiquidity(_testPoolKey(), _modifyLiqParams(), 0.6 ether, 0.6 ether, block.timestamp + 100);
        mockPM.setModifyLiquidityDelta(toBalanceDelta(int128(0.5 ether), int128(0.5 ether)));

        vm.warp(1);
        vm.prank(user);
        PoolKey memory key = _testPoolKey();
        vm.expectEmit(true, true, true, true);
        emit AetherRouter.LiquidityRemoved(user, keccak256(abi.encode(key)), 0.5 ether, 0.5 ether);
        router.removeLiquidity(key, _removeLiqParams(), 0, 0, block.timestamp + 100);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //  SINGLE-SIDED ZAP — ATOMIC SWAP + LIQUIDITY
    // ═══════════════════════════════════════════════════════════════════════════

    function test_addLiquiditySingleSided_swapsAddsAndRefundsDust() public {
        mockPM.setSwapDelta(toBalanceDelta(-int128(0.4 ether), int128(0.3 ether)));
        mockPM.setModifyLiquidityDelta(toBalanceDelta(-int128(0.5 ether), -int128(0.2 ether)));

        uint256 token0Before = token0.balanceOf(user);
        uint256 token1Before = token1.balanceOf(user);
        vm.warp(1);
        vm.prank(user);
        router.addLiquiditySingleSided(
            AetherRouter.SingleSidedLiquidityParams({
                poolKey: _testPoolKey(),
                liquidityParams: _modifyLiqParams(),
                zeroForOne: true,
                amountIn: 1 ether,
                swapAmountIn: 0.4 ether,
                minSwapAmountOut: 0.29 ether,
                minAmount0: 0.5 ether,
                minAmount1: 0.2 ether,
                deadline: block.timestamp + 100,
                hookData: ""
            })
        );

        assertEq(token0.balanceOf(user), token0Before - 0.9 ether);
        assertEq(token1.balanceOf(user), token1Before + 0.1 ether);
        PoolKey memory key = _testPoolKey();
        bytes32 positionId = keccak256(abi.encode(keccak256(abi.encode(key)), int24(-887220), int24(887220), bytes32(0)));
        assertEq(router.positionOwner(positionId), user);
    }

    function test_addLiquiditySingleSided_revertsOnSwapSlippage() public {
        mockPM.setSwapDelta(toBalanceDelta(-int128(0.4 ether), int128(0.1 ether)));
        vm.warp(1);
        vm.prank(user);
        vm.expectRevert();
        router.addLiquiditySingleSided(
            AetherRouter.SingleSidedLiquidityParams({
                poolKey: _testPoolKey(),
                liquidityParams: _modifyLiqParams(),
                zeroForOne: true,
                amountIn: 1 ether,
                swapAmountIn: 0.4 ether,
                minSwapAmountOut: 0.2 ether,
                minAmount0: 0,
                minAmount1: 0,
                deadline: block.timestamp + 100,
                hookData: ""
            })
        );
    }

    function test_removeLiquidity_revertsForNonOwner() public {
        mockPM.setModifyLiquidityDelta(toBalanceDelta(-int128(0.5 ether), -int128(0.5 ether)));
        vm.prank(user);
        router.addLiquidity(_testPoolKey(), _modifyLiqParams(), 0.6 ether, 0.6 ether, block.timestamp + 100);
        vm.prank(address(0xBEEF));
        vm.expectRevert(Errors.UnauthorizedPosition.selector);
        router.removeLiquidity(_testPoolKey(), _removeLiqParams(), 0, 0, block.timestamp + 100);
    }

    function test_removeLiquidity_partialRemovalRetainsAuthority() public {
        mockPM.setModifyLiquidityDelta(toBalanceDelta(-int128(0.5 ether), -int128(0.5 ether)));
        vm.prank(user);
        router.addLiquidity(_testPoolKey(), _modifyLiqParams(), 0.6 ether, 0.6 ether, block.timestamp + 100);

        ModifyLiquidityParams memory partialParams = ModifyLiquidityParams({
            tickLower: -887220,
            tickUpper: 887220,
            liquidityDelta: -0.4 ether,
            salt: 0
        });
        mockPM.setModifyLiquidityDelta(toBalanceDelta(int128(0.1 ether), int128(0.1 ether)));
        vm.prank(user);
        router.removeLiquidity(_testPoolKey(), partialParams, 0, 0, block.timestamp + 100);

        bytes32 positionId = keccak256(abi.encode(keccak256(abi.encode(_testPoolKey())), int24(-887220), int24(887220), bytes32(0)));
        assertEq(router.positionOwner(positionId), user);
        assertEq(router.positionLiquidity(positionId), 0.6 ether);
    }

    function test_addLiquiditySingleSided_allowsPreExistingTokenDust() public {
        token0.mint(address(router), 1);
        mockPM.setSwapDelta(toBalanceDelta(-int128(0.4 ether), int128(0.3 ether)));
        mockPM.setModifyLiquidityDelta(toBalanceDelta(-int128(0.5 ether), -int128(0.2 ether)));

        vm.warp(1);
        vm.prank(user);
        router.addLiquiditySingleSided(
            AetherRouter.SingleSidedLiquidityParams({
                poolKey: _testPoolKey(),
                liquidityParams: _modifyLiqParams(),
                zeroForOne: true,
                amountIn: 1 ether,
                swapAmountIn: 0.4 ether,
                minSwapAmountOut: 0.29 ether,
                minAmount0: 0.5 ether,
                minAmount1: 0.2 ether,
                deadline: block.timestamp + 100,
                hookData: ""
            })
        );
        assertEq(token0.balanceOf(address(router)), 1);
    }

    function test_addLiquiditySingleSided_settlesActualPartialSwapInput() public {
        mockPM.setSwapDelta(toBalanceDelta(-int128(0.2 ether), int128(0.15 ether)));
        mockPM.setModifyLiquidityDelta(toBalanceDelta(-int128(0.5 ether), -int128(0.1 ether)));

        vm.warp(1);
        vm.prank(user);
        router.addLiquiditySingleSided(
            AetherRouter.SingleSidedLiquidityParams({
                poolKey: _testPoolKey(),
                liquidityParams: _modifyLiqParams(),
                zeroForOne: true,
                amountIn: 1 ether,
                swapAmountIn: 0.4 ether,
                minSwapAmountOut: 0.14 ether,
                minAmount0: 0.5 ether,
                minAmount1: 0.1 ether,
                deadline: block.timestamp + 100,
                hookData: ""
            })
        );
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //  FACTORY + ROUTER INTEGRATION
    // ═══════════════════════════════════════════════════════════════════════════

    function test_factoryCreatePool_getPoolWorks() public {
        bytes32 id = factory.createPool(address(token0), address(token1), 3000, 60, INITIAL_SQRT_PRICE);
        PoolKey memory key = factory.getPool(id);
        assertEq(Currency.unwrap(key.currency0), address(token0));
        assertEq(Currency.unwrap(key.currency1), address(token1));
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //  REENTRANCY GUARD
    // ═══════════════════════════════════════════════════════════════════════════

    function test_receiveETH() public {
        vm.deal(address(this), 1 ether);
        (bool success,) = address(router).call{value: 1 ether}("");
        assertTrue(success, "Router should accept ETH");
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //  HELPERS
    // ═══════════════════════════════════════════════════════════════════════════

    function _testPoolKey() internal view returns (PoolKey memory) {
        return PoolKey({
            currency0: Currency.wrap(address(token0)),
            currency1: Currency.wrap(address(token1)),
            fee: 3000,
            tickSpacing: 60,
            hooks: IHooks(HOOK)
        });
    }

    function _swapExactInParams(uint256 deadline) internal view returns (AetherRouter.SwapExactInParams memory) {
        return AetherRouter.SwapExactInParams({
            poolKey: _testPoolKey(),
            zeroForOne: true,
            amountIn: 1 ether,
            minAmountOut: 0,
            deadline: deadline,
            hookData: ""
        });
    }

    function _swapExactOutParams(uint256 deadline) internal view returns (AetherRouter.SwapExactOutParams memory) {
        return AetherRouter.SwapExactOutParams({
            poolKey: _testPoolKey(),
            zeroForOne: true,
            amountOut: 1 ether,
            maxAmountIn: 2 ether,
            deadline: deadline,
            hookData: ""
        });
    }

    function _modifyLiqParams() internal pure returns (ModifyLiquidityParams memory) {
        return ModifyLiquidityParams({tickLower: -887220, tickUpper: 887220, liquidityDelta: 1e18, salt: 0});
    }

    function _removeLiqParams() internal pure returns (ModifyLiquidityParams memory) {
        return ModifyLiquidityParams({tickLower: -887220, tickUpper: 887220, liquidityDelta: -1e18, salt: 0});
    }
}

/// @notice Mock PoolManager that supports the subset of IPoolManager used by AetherRouter
contract MockPoolManager {
    using CurrencyLibrary for Currency;
    using SafeERC20 for IERC20;

    BalanceDelta public swapDelta;
    BalanceDelta public modifyLiquidityDelta;
    bool internal strictZap;
    bool internal unlocked;
    Currency internal syncedCurrency;
    uint256 internal syncedBalance;
    uint256 internal expectedSettle;
    uint256 internal expectedTake;
    bool internal modifying;
    Currency internal modifyCurrency0;
    Currency internal modifyCurrency1;

    function setSwapDelta(BalanceDelta delta) external {
        swapDelta = delta;
    }

    function setModifyLiquidityDelta(BalanceDelta delta) external {
        modifyLiquidityDelta = delta;
    }

    function initialize(PoolKey memory, uint160) external pure returns (int24) {
        return 0;
    }

    function unlock(bytes calldata data) external returns (bytes memory) {
        (uint8 action,) = abi.decode(data, (uint8, bytes));
        strictZap = action == 4;
        unlocked = true;
        bytes memory result = IUnlockCallback(msg.sender).unlockCallback(data);
        if (strictZap && (expectedSettle != 0 || expectedTake != 0)) revert("unsettled");
        unlocked = false;
        strictZap = false;
        return result;
    }

    function swap(PoolKey memory, SwapParams memory params, bytes calldata) external returns (BalanceDelta) {
        if (strictZap) {
            expectedSettle = params.zeroForOne ? uint256(-int256(swapDelta.amount0())) : uint256(-int256(swapDelta.amount1()));
            expectedTake = params.zeroForOne ? uint256(int256(swapDelta.amount1())) : uint256(int256(swapDelta.amount0()));
            modifying = false;
        }
        return swapDelta;
    }

    function modifyLiquidity(PoolKey memory key, ModifyLiquidityParams memory, bytes calldata)
        external
        returns (BalanceDelta callerDelta, BalanceDelta)
    {
        if (strictZap) {
            modifying = true;
            modifyCurrency0 = key.currency0;
            modifyCurrency1 = key.currency1;
        }
        return (modifyLiquidityDelta, BalanceDelta.wrap(0));
    }

    function sync(Currency currency) external {
        if (strictZap) {
            syncedCurrency = currency;
            syncedBalance = currency.balanceOfSelf();
            if (modifying) {
                expectedSettle = currency == modifyCurrency0
                    ? uint256(-int256(modifyLiquidityDelta.amount0()))
                    : uint256(-int256(modifyLiquidityDelta.amount1()));
            }
        }
    }

    function settle() external payable returns (uint256) {
        if (strictZap) {
            uint256 paid = msg.value > 0 ? msg.value : syncedCurrency.balanceOfSelf() - syncedBalance;
            if (paid != expectedSettle) revert("bad settle");
            expectedSettle = 0;
        }
        return 0;
    }

    function take(Currency currency, address to, uint256 amount) external {
        if (strictZap && amount != expectedTake) revert("bad take");
        if (strictZap) expectedTake = 0;
        IERC20(Currency.unwrap(currency)).safeTransfer(to, amount);
    }
}

/// @notice Simple mock ERC20 for router tests
contract MockERC20 is ERC20 {
    constructor(string memory name_, string memory symbol_) ERC20(name_, symbol_) {}

    function decimals() public pure override returns (uint8) {
        return 18;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
