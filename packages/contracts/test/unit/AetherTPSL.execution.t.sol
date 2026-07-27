// SPDX-License-Identifier: MIT
pragma solidity ^0.8.31;

import "forge-std/Test.sol";
import {AetherTPSL} from "src/tpsl/AetherTPSL.sol";
import {IAetherHook} from "src/hook/IAetherHook.sol";
import {Errors} from "src/lib/Errors.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {IUnlockCallback} from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {BalanceDelta, toBalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract TpslExecToken is ERC20 {
    constructor(string memory name_, string memory symbol_) ERC20(name_, symbol_) {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract TpslExecHook is IAetherHook {
    uint256 private _twapPrice = 1e18;
    bool private _revertTwap;

    function setTwapPrice(uint256 price) external {
        _twapPrice = price;
    }

    function setRevertTwap(bool shouldRevert) external {
        _revertTwap = shouldRevert;
    }

    function getCurrentTwap(bytes32, uint32) external view returns (uint256) {
        if (_revertTwap) revert Errors.InsufficientObservations();
        return _twapPrice;
    }

    function getCurrentTwapInverted(bytes32, uint32) external view returns (uint256) {
        return _twapPrice;
    }

    function getLatestObservation(bytes32) external view returns (uint32, int56, int24) {
        return (uint32(block.timestamp), 0, 0);
    }
}

contract TpslExecPoolManager {
    bytes32 internal _slot0Word;
    int128 internal _deltaAmount0;
    int128 internal _deltaAmount1;

    function setTick(int24 tick) external {
        uint160 sqrtPriceX96 = TickMath.getSqrtPriceAtTick(tick);
        _slot0Word = bytes32(uint256(sqrtPriceX96) | (uint256(uint24(tick)) << 160));
    }

    function setSwapDelta(int128 amount0, int128 amount1) external {
        _deltaAmount0 = amount0;
        _deltaAmount1 = amount1;
    }

    function extsload(bytes32) external view returns (bytes32) {
        return _slot0Word;
    }

    function unlock(bytes calldata data) external returns (bytes memory) {
        return IUnlockCallback(msg.sender).unlockCallback(data);
    }

    function swap(PoolKey memory, SwapParams memory, bytes calldata) external view returns (BalanceDelta) {
        return toBalanceDelta(_deltaAmount0, _deltaAmount1);
    }

    function sync(Currency) external {}

    function settle() external payable returns (uint256 paid) {
        return 0;
    }

    function take(Currency currency, address to, uint256 amount) external {
        ERC20(Currency.unwrap(currency)).transfer(to, amount);
    }
}

contract AetherTPSLExecutionTest is Test {
    AetherTPSL tpsl;
    AetherTPSL callbackTpsl;
    TpslExecPoolManager poolManager;
    TpslExecHook hook;
    TpslExecToken token0;
    TpslExecToken token1;

    address constant OWNER = address(0x1000);
    address constant USER = address(0x2000);

    function setUp() public {
        vm.warp(1_000_000_000);

        poolManager = new TpslExecPoolManager();
        hook = new TpslExecHook();
        token0 = new TpslExecToken("Token0", "TK0");
        token1 = new TpslExecToken("Token1", "TK1");

        tpsl = new AetherTPSL(IPoolManager(address(poolManager)), IAetherHook(address(hook)), OWNER);
        callbackTpsl = new AetherTPSL(IPoolManager(address(this)), IAetherHook(address(hook)), OWNER);

        poolManager.setTick(0);
        hook.setTwapPrice(1e18);

        token0.mint(USER, 1_000e18);
        token1.mint(USER, 1_000e18);
        token0.mint(address(poolManager), 1_000e18);
        token1.mint(address(poolManager), 1_000e18);

        vm.startPrank(USER);
        token0.approve(address(tpsl), type(uint256).max);
        token1.approve(address(tpsl), type(uint256).max);
        vm.stopPrank();
    }

    function test_executeOrder_takeProfit_zeroForOne_success() public {
        uint256 orderId = _createOrder(AetherTPSL.OrderType.TAKE_PROFIT, true, 1e18, 9e17);
        poolManager.setSwapDelta(-1e18, 1e18);

        vm.prank(address(0x4000));
        bool executed = tpsl.executeOrder(orderId, "");

        assertTrue(executed);
        AetherTPSL.TpSlOrder memory order = tpsl.getOrder(orderId);
        assertEq(uint8(order.status), uint8(AetherTPSL.OrderStatus.EXECUTED));
        assertEq(order.executedAt, block.timestamp);
        assertEq(token1.balanceOf(USER), 1_001e18);
    }

    function test_executeOrder_takeProfit_oneForZero_success() public {
        hook.setTwapPrice(2e18);
        poolManager.setTick(7000); // price > 2.0
        uint256 orderId = _createOrder(AetherTPSL.OrderType.TAKE_PROFIT, false, 2e18, 1.9e18);
        poolManager.setSwapDelta(2e18, -2e18);

        bool executed = tpsl.executeOrder(orderId, "");

        assertTrue(executed);
        assertEq(token0.balanceOf(USER), 1_002e18);
    }

    function test_executeOrder_stopLoss_zeroForOne_success() public {
        hook.setTwapPrice(1e18);
        poolManager.setTick(0);
        uint256 orderId = _createOrder(AetherTPSL.OrderType.STOP_LOSS, true, 5e17, 4e17);
        poolManager.setSwapDelta(-1e18, 9e17);

        bool executed = tpsl.executeOrder(orderId, "");

        assertTrue(executed);
        assertEq(token1.balanceOf(USER), 1_000.9e18);
    }

    function test_executeOrder_stopLoss_oneForZero_success() public {
        hook.setTwapPrice(5e17);
        poolManager.setTick(-7000); // price < 0.5
        uint256 orderId = _createOrder(AetherTPSL.OrderType.STOP_LOSS, false, 5e17, 4e17);
        poolManager.setSwapDelta(9e17, -1e18);

        bool executed = tpsl.executeOrder(orderId, "");

        assertTrue(executed);
        assertEq(token0.balanceOf(USER), 1_000.9e18);
    }

    function test_executeOrder_emitsEvent() public {
        uint256 orderId = _createOrder(AetherTPSL.OrderType.TAKE_PROFIT, true, 1e18, 9e17);
        poolManager.setSwapDelta(-1e18, 1e18);

        vm.expectEmit(true, true, false, true);
        emit AetherTPSL.OrderExecuted(orderId, USER, 1e18, block.timestamp);
        tpsl.executeOrder(orderId, "");
    }

    function test_executeOrder_revertsWhenNotPending() public {
        uint256 orderId = _createOrder(AetherTPSL.OrderType.TAKE_PROFIT, true, 1e18, 9e17);
        vm.prank(USER);
        tpsl.cancelOrder(orderId);

        vm.expectRevert(AetherTPSL.OrderNotPending.selector);
        tpsl.executeOrder(orderId, "");
    }

    function test_executeOrder_marksExpiredAndReverts() public {
        uint256 orderId = _createOrderWithDeadline(block.timestamp + 5);
        poolManager.setSwapDelta(-1e18, 1e18);

        vm.warp(block.timestamp + 10);

        vm.expectRevert(AetherTPSL.OrderExpired.selector);
        tpsl.executeOrder(orderId, "");

        AetherTPSL.TpSlOrder memory order = tpsl.getOrder(orderId);
        assertEq(uint8(order.status), uint8(AetherTPSL.OrderStatus.PENDING));
    }

    function test_executeOrder_revertsWhenTriggerNotBreached() public {
        uint256 orderId = _createOrder(AetherTPSL.OrderType.TAKE_PROFIT, true, 5e17, 4e17);
        hook.setTwapPrice(1e18); // above trigger -> not breached

        vm.expectRevert(AetherTPSL.TriggerNotBreached.selector);
        tpsl.executeOrder(orderId, "");
    }

    function test_executeOrder_skipsWhenTwapOracleUnavailable() public {
        uint256 orderId = _createOrder(AetherTPSL.OrderType.TAKE_PROFIT, true, 1e18, 9e17);
        hook.setRevertTwap(true);
        poolManager.setSwapDelta(-1e18, 1e18);

        bool executed = tpsl.executeOrder(orderId, "");

        assertFalse(executed);
        AetherTPSL.TpSlOrder memory order = tpsl.getOrder(orderId);
        assertEq(uint8(order.status), uint8(AetherTPSL.OrderStatus.PENDING));
    }

    function test_executeOrder_revertsWhenAmountOutBelowMinimum() public {
        uint256 orderId = _createOrder(AetherTPSL.OrderType.TAKE_PROFIT, true, 1e18, 9e17);
        poolManager.setSwapDelta(-1e18, 8e17);

        vm.expectRevert(AetherTPSL.ExecutionFailed.selector);
        tpsl.executeOrder(orderId, "");
    }

    function test_executeOrder_handlesZeroOutputWithoutTake() public {
        uint256 orderId = _createOrder(AetherTPSL.OrderType.TAKE_PROFIT, true, 1e18, 0);
        poolManager.setSwapDelta(-1e18, 0);

        bool executed = tpsl.executeOrder(orderId, "");

        assertTrue(executed);
        assertEq(token1.balanceOf(USER), 1_000e18);
    }

    function test_isTriggered_matrix() public {
        hook.setTwapPrice(1e18);
        poolManager.setTick(0);

        uint256 tpZeroForOne = _createOrder(AetherTPSL.OrderType.TAKE_PROFIT, true, 1e18, 0);
        assertTrue(tpsl.isTriggered(tpZeroForOne));
        assertTrue(tpsl.checkTrigger(tpZeroForOne));

        uint256 tpOneForZero = _createOrder(AetherTPSL.OrderType.TAKE_PROFIT, false, 1e18, 0);
        assertTrue(tpsl.isTriggered(tpOneForZero));

        uint256 slZeroForOne = _createOrder(AetherTPSL.OrderType.STOP_LOSS, true, 1e18, 0);
        assertTrue(tpsl.isTriggered(slZeroForOne));

        uint256 slOneForZero = _createOrder(AetherTPSL.OrderType.STOP_LOSS, false, 1e18, 0);
        assertTrue(tpsl.isTriggered(slOneForZero));

        hook.setTwapPrice(2e18);
        assertFalse(tpsl.isTriggered(tpZeroForOne));

        hook.setRevertTwap(true);
        assertFalse(tpsl.isTriggered(tpZeroForOne));
    }

    function test_unlockCallback_revertsForUnauthorizedCaller() public {
        bytes memory data = abi.encode(AetherTPSL.Action.SWAP_EXACT_IN, bytes(""));
        vm.expectRevert(Errors.Unauthorized.selector);
        tpsl.unlockCallback(data);
    }

    function test_unlockCallback_revertsForPositiveAmountSpecified() public {
        PoolKey memory poolKey = _poolKey();
        SwapParams memory swapParams =
            SwapParams({zeroForOne: true, amountSpecified: 1, sqrtPriceLimitX96: TickMath.MIN_SQRT_PRICE + 1});
        bytes memory actionData = abi.encode(poolKey, swapParams, bytes(""), USER);
        bytes memory data = abi.encode(AetherTPSL.Action.SWAP_EXACT_IN, actionData);

        vm.expectRevert(AetherTPSL.InvalidAmount.selector);
        callbackTpsl.unlockCallback(data);
    }

    function _poolKey() internal view returns (PoolKey memory) {
        return PoolKey({
            currency0: Currency.wrap(address(token0)),
            currency1: Currency.wrap(address(token1)),
            fee: 3000,
            tickSpacing: 60,
            hooks: IHooks(address(hook))
        });
    }

    function _params(
        AetherTPSL.OrderType orderType,
        bool zeroForOne,
        uint256 amountIn,
        uint256 minAmountOut,
        uint256 triggerPriceX18,
        uint256 deadline
    ) internal view returns (AetherTPSL.CreateOrderParams memory) {
        return AetherTPSL.CreateOrderParams({
            poolKey: _poolKey(),
            orderType: orderType,
            zeroForOne: zeroForOne,
            amountIn: uint128(amountIn),
            minAmountOut: uint128(minAmountOut),
            triggerPriceX18: triggerPriceX18,
            twapWindow: 300,
            slippageBps: 100,
            deadline: deadline
        });
    }

    function _createOrder(AetherTPSL.OrderType orderType, bool zeroForOne, uint256 triggerPriceX18, uint256 minAmountOut)
        internal
        returns (uint256 orderId)
    {
        vm.prank(USER);
        orderId = tpsl.createOrder(
            _params(orderType, zeroForOne, 1e18, minAmountOut, triggerPriceX18, block.timestamp + 3600)
        );
    }

    function _createOrderWithDeadline(uint256 deadline) internal returns (uint256 orderId) {
        vm.prank(USER);
        orderId = tpsl.createOrder(
            _params(AetherTPSL.OrderType.TAKE_PROFIT, true, 1e18, 9e17, 1e18, deadline)
        );
    }
}
