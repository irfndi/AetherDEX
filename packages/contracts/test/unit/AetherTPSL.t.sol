// SPDX-License-Identifier: MIT
pragma solidity ^0.8.31;

import "forge-std/Test.sol";
import {AetherTPSL} from "src/tpsl/AetherTPSL.sol";
import {IAetherHook} from "src/hook/IAetherHook.sol";
import {Errors} from "src/lib/Errors.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {BalanceDelta, toBalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {MockPoolManager} from "../shared/MockPoolManager.sol";

/// @title MockAetherHook
/// @notice Mock hook for testing TP/SL trigger validation
contract MockAetherHook is IAetherHook {
    uint256 private _twapPrice;
    int24 private _currentTick;

    function setTwapPrice(uint256 price) external {
        _twapPrice = price;
    }

    function setCurrentTick(int24 tick) external {
        _currentTick = tick;
    }

    function getCurrentTwap(bytes32, uint32) external view returns (uint256) {
        return _twapPrice;
    }

    function getCurrentTwapInverted(bytes32, uint32) external view returns (uint256) {
        if (_twapPrice == 0) return 0;
        return 1e36 / _twapPrice;
    }

    function getLatestObservation(bytes32) external view returns (uint32, int56, int24) {
        return (uint32(block.timestamp), 0, _currentTick);
    }
}

/// @title AetherTPSL Unit Tests
/// @notice Tests for V4-native TP/SL order module
contract AetherTPSLTest is Test {
    AetherTPSL tpsl;
    MockPoolManager mockPoolManager;
    MockAetherHook mockHook;

    address constant OWNER = address(0x1000);
    address constant USER = address(0x2000);
    address constant NOT_USER = address(0x3000);
    address constant KEEPER = address(0x4000);

    address constant TOKEN0 = address(0xA000);
    address constant TOKEN1 = address(0xB000);

    uint256 internal _clock = 1_000_000_000;

    function setUp() public {
        vm.warp(_clock);

        mockPoolManager = new MockPoolManager();
        mockHook = new MockAetherHook();

        tpsl = new AetherTPSL(
            IPoolManager(address(mockPoolManager)),
            IAetherHook(address(mockHook)),
            OWNER
        );

        // Set default pool state
        mockHook.setTwapPrice(1e18); // price = 1.0
        mockHook.setCurrentTick(0);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //  CONSTRUCTOR
    // ═══════════════════════════════════════════════════════════════════════════

    function test_constructor_setsCorrectValues() public view {
        assertEq(address(tpsl.poolManager()), address(mockPoolManager));
        assertEq(address(tpsl.aetherHook()), address(mockHook));
        assertEq(tpsl.owner(), OWNER);
    }

    function test_constructor_revertsZeroPoolManager() public {
        vm.expectRevert(Errors.ZeroAddress.selector);
        new AetherTPSL(
            IPoolManager(address(0)),
            IAetherHook(address(mockHook)),
            OWNER
        );
    }

    function test_constructor_revertsZeroHook() public {
        vm.expectRevert(Errors.ZeroAddress.selector);
        new AetherTPSL(
            IPoolManager(address(mockPoolManager)),
            IAetherHook(address(0)),
            OWNER
        );
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //  CREATE ORDER
    // ═══════════════════════════════════════════════════════════════════════════

    function test_createOrder_success() public {
        vm.prank(USER);
        uint256 orderId = tpsl.createOrder(_defaultParams());

        assertEq(orderId, 0, "First order ID should be 0");
        assertEq(tpsl.nextOrderId(), 1, "Next order ID should be 1");

        AetherTPSL.TpSlOrder memory order = tpsl.getOrder(orderId);

        assertEq(order.owner, USER);
        assertEq(uint8(order.orderType), uint8(AetherTPSL.OrderType.TAKE_PROFIT));
        assertTrue(order.zeroForOne);
        assertEq(order.triggerPriceX18, 1e18);
        assertEq(uint8(order.status), uint8(AetherTPSL.OrderStatus.PENDING));
    }

    function test_createOrder_revertsZeroAmount() public {
        AetherTPSL.CreateOrderParams memory params = _defaultParams();
        params.amountIn = 0;

        vm.prank(USER);
        vm.expectRevert(AetherTPSL.InvalidAmount.selector);
        tpsl.createOrder(params);
    }

    function test_createOrder_revertsSlippageTooHigh() public {
        AetherTPSL.CreateOrderParams memory params = _defaultParams();
        params.slippageBps = 600; // 6% > 5% max

        vm.prank(USER);
        vm.expectRevert(AetherTPSL.SlippageTooHigh.selector);
        tpsl.createOrder(params);
    }

    function test_createOrder_revertsInvalidTwapWindow() public {
        AetherTPSL.CreateOrderParams memory params = _defaultParams();
        params.twapWindow = 0;

        vm.prank(USER);
        vm.expectRevert(AetherTPSL.InvalidTwapWindow.selector);
        tpsl.createOrder(params);
    }

    function test_createOrder_revertsInvalidTriggerPrice() public {
        AetherTPSL.CreateOrderParams memory params = _defaultParams();
        params.triggerPriceX18 = 0;

        vm.prank(USER);
        vm.expectRevert(AetherTPSL.InvalidTriggerPrice.selector);
        tpsl.createOrder(params);
    }

    function test_createOrder_revertsDeadlineExpired() public {
        AetherTPSL.CreateOrderParams memory params = _defaultParams();
        params.deadline = block.timestamp - 1;

        vm.prank(USER);
        vm.expectRevert(Errors.DeadlineExpired.selector);
        tpsl.createOrder(params);
    }

    function test_createOrder_multipleOrders() public {
        vm.prank(USER);
        uint256 id1 = tpsl.createOrder(_defaultParams());

        vm.prank(USER);
        uint256 id2 = tpsl.createOrder(_slParams());

        assertEq(id1, 0);
        assertEq(id2, 1);
        assertEq(tpsl.nextOrderId(), 2);
    }

    function test_createOrder_emitsEvent() public {
        vm.prank(USER);
        vm.expectEmit(true, true, true, true);
        emit AetherTPSL.OrderCreated(
            0,
            USER,
            AetherTPSL.OrderType.TAKE_PROFIT,
            keccak256(abi.encode(_defaultPoolKey())),
            true,
            1e18,
            1e18
        );
        tpsl.createOrder(_defaultParams());
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //  CANCEL ORDER
    // ═══════════════════════════════════════════════════════════════════════════

    function test_cancelOrder_success() public {
        vm.prank(USER);
        uint256 orderId = tpsl.createOrder(_defaultParams());

        vm.prank(USER);
        tpsl.cancelOrder(orderId);

        AetherTPSL.TpSlOrder memory order = tpsl.getOrder(orderId);
        assertEq(uint8(order.status), uint8(AetherTPSL.OrderStatus.CANCELLED));
    }

    function test_cancelOrder_revertsNotOwner() public {
        vm.prank(USER);
        uint256 orderId = tpsl.createOrder(_defaultParams());

        vm.prank(NOT_USER);
        vm.expectRevert(AetherTPSL.UnauthorizedOrderAccess.selector);
        tpsl.cancelOrder(orderId);
    }

    function test_cancelOrder_revertsNotPending() public {
        vm.prank(USER);
        uint256 orderId = tpsl.createOrder(_defaultParams());

        vm.prank(USER);
        tpsl.cancelOrder(orderId);

        vm.prank(USER);
        vm.expectRevert(AetherTPSL.OrderNotPending.selector);
        tpsl.cancelOrder(orderId);
    }

    function test_cancelOrder_emitsEvent() public {
        vm.prank(USER);
        uint256 orderId = tpsl.createOrder(_defaultParams());

        vm.expectEmit(true, true, true, true);
        emit AetherTPSL.OrderCancelled(orderId, USER);

        vm.prank(USER);
        tpsl.cancelOrder(orderId);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //  VIEW FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════════════

    function test_getOwnerOrders() public {
        vm.prank(USER);
        tpsl.createOrder(_defaultParams());
        vm.prank(USER);
        tpsl.createOrder(_slParams());
        vm.prank(NOT_USER);
        tpsl.createOrder(_defaultParams());

        uint256[] memory userOrders = tpsl.getOwnerOrders(USER);
        assertEq(userOrders.length, 2, "User should have 2 orders");

        uint256[] memory notUserOrders = tpsl.getOwnerOrders(NOT_USER);
        assertEq(notUserOrders.length, 1, "NOT_USER should have 1 order");
    }

    function test_getPoolOrders() public {
        vm.prank(USER);
        tpsl.createOrder(_defaultParams());
        vm.prank(USER);
        tpsl.createOrder(_slParams());

        bytes32 poolId = keccak256(abi.encode(_defaultPoolKey()));
        uint256[] memory orders = tpsl.getPoolOrders(poolId);
        assertEq(orders.length, 2, "Pool should have 2 orders");
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //  TRIGGER CHECK
    // ═══════════════════════════════════════════════════════════════════════════

    function test_isTriggered_returnsFalseWhenNotPending() public {
        vm.prank(USER);
        uint256 orderId = tpsl.createOrder(_defaultParams());

        vm.prank(USER);
        tpsl.cancelOrder(orderId);

        assertFalse(tpsl.isTriggered(orderId));
    }

    function test_isTriggered_returnsFalseWhenExpired() public {
        AetherTPSL.CreateOrderParams memory params = _defaultParams();
        params.deadline = block.timestamp + 10;

        vm.prank(USER);
        uint256 orderId = tpsl.createOrder(params);

        // Warp past deadline
        vm.warp(block.timestamp + 20);

        assertFalse(tpsl.isTriggered(orderId));
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //  MAX CONSTANTS
    // ═══════════════════════════════════════════════════════════════════════════

    function test_maxSlippageBps() public view {
        assertEq(tpsl.MAX_SLIPPAGE_BPS(), 500, "Max slippage should be 500 bps (5%)");
    }

    function test_maxTwapWindow() public view {
        assertEq(tpsl.MAX_TWAP_WINDOW(), 3600, "Max TWAP window should be 3600 seconds (1 hour)");
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //  HELPERS
    // ═══════════════════════════════════════════════════════════════════════════

    function _defaultPoolKey() internal pure returns (PoolKey memory) {
        return PoolKey({
            currency0: Currency.wrap(TOKEN0),
            currency1: Currency.wrap(TOKEN1),
            fee: 3000,
            tickSpacing: 60,
            hooks: IHooks(address(0))
        });
    }

    function _defaultParams() internal view returns (AetherTPSL.CreateOrderParams memory) {
        return AetherTPSL.CreateOrderParams({
            poolKey: _defaultPoolKey(),
            orderType: AetherTPSL.OrderType.TAKE_PROFIT,
            zeroForOne: true,
            amountIn: uint128(1e18),
            minAmountOut: uint128(9e17), // 10% slippage tolerance
            triggerPriceX18: 1e18,
            twapWindow: 300, // 5 minutes
            slippageBps: 100, // 1%
            deadline: block.timestamp + 3600
        });
    }

    function _slParams() internal view returns (AetherTPSL.CreateOrderParams memory) {
        return AetherTPSL.CreateOrderParams({
            poolKey: _defaultPoolKey(),
            orderType: AetherTPSL.OrderType.STOP_LOSS,
            zeroForOne: true,
            amountIn: uint128(1e18),
            minAmountOut: uint128(9e17),
            triggerPriceX18: 5e17, // price drops to 0.5
            twapWindow: 300,
            slippageBps: 100,
            deadline: block.timestamp + 3600
        });
    }
}
