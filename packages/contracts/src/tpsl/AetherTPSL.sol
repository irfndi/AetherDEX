// SPDX-License-Identifier: MIT
pragma solidity ^0.8.31;

import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency, CurrencyLibrary} from "@uniswap/v4-core/src/types/Currency.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {IUnlockCallback} from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {FullMath} from "@uniswap/v4-core/src/libraries/FullMath.sol";
import {FixedPoint96} from "@uniswap/v4-core/src/libraries/FixedPoint96.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IAetherHook} from "../hook/IAetherHook.sol";
import {Errors} from "../lib/Errors.sol";

/// @title AetherTPSL
/// @notice V4-native take-profit / stop-loss module for Uniswap V4 concentrated-liquidity positions.
/// @dev Orders are stored on-chain with owner-only proceeds, spot+TWAP dual trigger,
///      slippage cap, and expiry. The keeper evaluates trigger conditions against the
///      AetherHook TWAP oracle and executes swaps through the PoolManager.
///
///      Design principles:
///      - Owner-only proceeds: execution sends proceeds only to the order creator
///      - Dual trigger: both spot price AND TWAP must breach the trigger (anti-flash-loan)
///      - Slippage cap: maximum 5% slippage on execution
///      - Expiry: orders expire after a configurable deadline
///      - Non-custodial: this contract holds NO user funds between transactions. On
///        execution the input is pulled only once the dual trigger is re-verified, settled
///        to the PoolManager within the same atomic transaction, and swap proceeds are
///        taken DIRECTLY from the PoolManager to the order owner (`take(currencyOut,
///        order.owner, …)`). There is no deposit/withdraw layer and no intermediary balance.
contract AetherTPSL is IUnlockCallback, Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;
    using CurrencyLibrary for Currency;
    using PoolIdLibrary for PoolKey;
    using StateLibrary for IPoolManager;

    // ── Types ──────────────────────────────────────────────────────────────

    enum OrderType {
        TAKE_PROFIT,
        STOP_LOSS
    }

    enum OrderStatus {
        PENDING,
        EXECUTED,
        CANCELLED,
        EXPIRED
    }

    struct TpSlOrder {
        uint256 id;
        address owner;
        OrderType orderType;
        PoolKey poolKey;
        bool zeroForOne;
        uint128 amountIn;
        uint128 minAmountOut;
        uint256 triggerPriceX18; // 1e18-scaled trigger price
        uint32 twapWindow; // seconds for TWAP averaging
        uint256 slippageBps; // max slippage in basis points (max 500 = 5%)
        uint256 deadline;
        OrderStatus status;
        uint256 createdAt;
        uint256 executedAt;
    }

    struct CreateOrderParams {
        PoolKey poolKey;
        OrderType orderType;
        bool zeroForOne;
        uint128 amountIn;
        uint128 minAmountOut;
        uint256 triggerPriceX18;
        uint32 twapWindow;
        uint256 slippageBps;
        uint256 deadline;
    }

    // ── Storage ────────────────────────────────────────────────────────────

    IPoolManager public immutable poolManager;
    IAetherHook public immutable aetherHook;

    uint256 public nextOrderId;
    mapping(uint256 => TpSlOrder) public orders;
    mapping(address => uint256[]) public ownerOrders;
    mapping(bytes32 => uint256[]) public poolOrders;
    /// @notice Maximum slippage allowed (5% = 500 bps)
    uint256 public constant MAX_SLIPPAGE_BPS = 500;

    /// @notice Maximum TWAP window (1 hour)
    uint32 public constant MAX_TWAP_WINDOW = 3600;

    // ── Events ─────────────────────────────────────────────────────────────

    event OrderCreated(
        uint256 indexed orderId,
        address indexed owner,
        OrderType orderType,
        bytes32 indexed poolId,
        bool zeroForOne,
        uint128 amountIn,
        uint256 triggerPriceX18
    );

    event OrderExecuted(uint256 indexed orderId, address indexed owner, uint256 amountOut, uint256 timestamp);

    event OrderCancelled(uint256 indexed orderId, address indexed owner);

    // ── Errors ─────────────────────────────────────────────────────────────

    error OrderNotPending();
    error OrderExpired();
    error SlippageTooHigh();
    error InvalidTriggerPrice();
    error InvalidTwapWindow();
    error InvalidAmount();
    error UnauthorizedOrderAccess();
    error TriggerNotBreached();
    error ExecutionFailed();

    // ── Constructor ────────────────────────────────────────────────────────

    constructor(IPoolManager _poolManager, IAetherHook _aetherHook, address _initialOwner) Ownable(_initialOwner) {
        if (address(_poolManager) == address(0)) revert Errors.ZeroAddress();
        if (address(_aetherHook) == address(0)) revert Errors.ZeroAddress();
        poolManager = _poolManager;
        aetherHook = _aetherHook;
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //  USER-FACING FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════════════

    /// @notice Create a new TP/SL order
    /// @param params Order parameters
    /// @return orderId The ID of the created order
    function createOrder(CreateOrderParams calldata params) external nonReentrant returns (uint256 orderId) {
        if (block.timestamp > params.deadline) revert Errors.DeadlineExpired();
        if (params.amountIn == 0) revert InvalidAmount();
        if (params.slippageBps > MAX_SLIPPAGE_BPS) revert SlippageTooHigh();
        if (params.twapWindow == 0 || params.twapWindow > MAX_TWAP_WINDOW) revert InvalidTwapWindow();
        if (params.triggerPriceX18 == 0) revert InvalidTriggerPrice();
        if (params.poolKey.currency0.isAddressZero() || params.poolKey.currency1.isAddressZero()) {
            revert InvalidAmount();
        }

        orderId = nextOrderId++;

        // Validate trigger direction matches order type
        // For TP zeroForOne: price must go DOWN (token0 → token1, price decreases)
        // For TP oneForZero: price must go UP (token1 → token0, price increases)
        // For SL zeroForOne: price must go UP (opposite of TP)
        // For SL oneForZero: price must go DOWN (opposite of TP)

        orders[orderId] = TpSlOrder({
            id: orderId,
            owner: msg.sender,
            orderType: params.orderType,
            poolKey: params.poolKey,
            zeroForOne: params.zeroForOne,
            amountIn: params.amountIn,
            minAmountOut: params.minAmountOut,
            triggerPriceX18: params.triggerPriceX18,
            twapWindow: params.twapWindow,
            slippageBps: params.slippageBps,
            deadline: params.deadline,
            status: OrderStatus.PENDING,
            createdAt: block.timestamp,
            executedAt: 0
        });

        ownerOrders[msg.sender].push(orderId);
        poolOrders[PoolId.unwrap(params.poolKey.toId())].push(orderId);

        emit OrderCreated(
            orderId,
            msg.sender,
            params.orderType,
            PoolId.unwrap(params.poolKey.toId()),
            params.zeroForOne,
            params.amountIn,
            params.triggerPriceX18
        );
    }

    /// @notice Cancel a pending order (owner only)
    /// @param orderId The order to cancel
    function cancelOrder(uint256 orderId) external nonReentrant {
        TpSlOrder storage order = orders[orderId];
        if (order.owner != msg.sender) revert UnauthorizedOrderAccess();
        if (order.status != OrderStatus.PENDING) revert OrderNotPending();

        order.status = OrderStatus.CANCELLED;
        emit OrderCancelled(orderId, msg.sender);
    }

    /// @notice Execute a triggered order (called by keeper after trigger validation)
    /// @dev Non-custodial ordering guarantees, by construction:
    ///      1. The dual trigger is re-verified BEFORE any funds move. If the hook's TWAP
    ///         oracle cannot answer (e.g. insufficient observations), the order is SKIPPED
    ///         (returns false) instead of reverting, so one unverifiable order cannot brick
    ///         a keeper's batch execution.
    ///      2. Input tokens are pulled from the owner only once execution is committed, are
    ///         settled to the PoolManager inside the same unlock callback, and swap proceeds
    ///         are taken DIRECTLY from the PoolManager to the order owner — this contract
    ///         never holds user output and keeps no balance between transactions.
    /// @param orderId The order to execute
    /// @param hookData Data passed to the hook (for TWAP verification)
    /// @return executed True if the swap executed; false if skipped (oracle unavailable)
    function executeOrder(uint256 orderId, bytes calldata hookData) external nonReentrant returns (bool executed) {
        TpSlOrder storage order = orders[orderId];
        if (order.status != OrderStatus.PENDING) revert OrderNotPending();
        if (block.timestamp > order.deadline) {
            order.status = OrderStatus.EXPIRED;
            revert OrderExpired();
        }

        // Validate trigger first: both spot AND TWAP must breach. A failing oracle read
        // returns false here (skip) rather than reverting the whole execution batch.
        if (!_validateTrigger(order)) return false;

        // Pull input from the owner only now that execution is committed.
        address tokenIn = Currency.unwrap(order.zeroForOne ? order.poolKey.currency0 : order.poolKey.currency1);
        // By design: the keeper executes the owner's own order, so input is pulled only from order.owner
        // (who must have approved tokenIn); proceeds settle straight back to order.owner, never a third party.
        // slither-disable-next-line arbitrary-send-erc20
        IERC20(tokenIn).safeTransferFrom(order.owner, address(this), order.amountIn);

        // Execute the swap via PoolManager; proceeds go directly to the order owner.
        SwapParams memory swapParams = SwapParams({
            zeroForOne: order.zeroForOne,
            amountSpecified: -int256(uint256(order.amountIn)),
            sqrtPriceLimitX96: _sqrtPriceLimit(order.zeroForOne)
        });

        // Trusted V4 PoolManager unlock callback: executeOrder is nonReentrant, order status is committed
        // only after the callback returns, and getOrder/isTriggered observe consistent post-execution state.
        // slither-disable-next-line reentrancy-no-eth
        bytes memory result = poolManager.unlock(
            abi.encode(Action.SWAP_EXACT_IN, abi.encode(order.poolKey, swapParams, hookData, order.owner))
        );

        BalanceDelta delta = abi.decode(result, (BalanceDelta));
        uint256 amountOut = order.zeroForOne ? uint256(int256(delta.amount1())) : uint256(int256(delta.amount0()));

        // Slippage check — a revert here atomically unwinds the input pull, so the owner
        // never loses funds to a failed execution.
        if (amountOut < order.minAmountOut) revert ExecutionFailed();

        order.status = OrderStatus.EXECUTED;
        order.executedAt = block.timestamp;

        emit OrderExecuted(orderId, order.owner, amountOut, block.timestamp);
        executed = true;
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //  VIEW FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════════════

    /// @notice Get all orders for a user
    /// @param owner The user address
    /// @return orderIds Array of order IDs
    function getOwnerOrders(address owner) external view returns (uint256[] memory) {
        return ownerOrders[owner];
    }

    function getOrder(uint256 orderId) external view returns (TpSlOrder memory) {
        return orders[orderId];
    }

    /// @notice Get all orders for a pool
    /// @param poolId The pool ID
    /// @return orderIds Array of order IDs
    function getPoolOrders(bytes32 poolId) external view returns (uint256[] memory) {
        return poolOrders[poolId];
    }

    /// @notice Check if an order's trigger is currently breached
    /// @param orderId The order to check
    /// @return triggered Whether the trigger condition is met
    function isTriggered(uint256 orderId) public view returns (bool triggered) {
        TpSlOrder memory order = orders[orderId];
        if (order.status != OrderStatus.PENDING) return false;
        if (block.timestamp > order.deadline) return false;

        // Read current spot price (only the tick is needed; the other getSlot0 outputs are intentionally unused).
        // slither-disable-next-line unused-return
        (, int24 tick,,) = poolManager.getSlot0(order.poolKey.toId());
        uint256 spotPriceX18 = _tickToPriceX18(tick);

        // Read TWAP from AetherHook (with fallback)
        uint256 twapPriceX18 = 0;
        try aetherHook.getCurrentTwap(PoolId.unwrap(order.poolKey.toId()), order.twapWindow) returns (uint256 price) {
            twapPriceX18 = price;
        } catch {
            return false; // TWAP not available
        }

        return _evaluateTrigger(order, spotPriceX18, twapPriceX18);
    }

    /// @notice External trigger check (for keeper simulation)
    /// @param orderId The order to check
    /// @return triggered Whether the trigger condition is met
    function checkTrigger(uint256 orderId) external view returns (bool triggered) {
        return isTriggered(orderId);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //  INTERNAL FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════════════

    /// @dev Re-validates the dual trigger (spot AND TWAP) at execution time.
    ///      Returns false — meaning "skip, do not execute" — when the hook's TWAP read
    ///      reverts (e.g. {Errors.InsufficientObservations}): executing a TP/SL on spot
    ///      alone would defeat the anti-flash-loan dual trigger, but the oracle being
    ///      temporarily unavailable must not revert (and thus brick) a keeper's batch.
    ///      A healthy oracle whose prices have not breached still reverts
    ///      {TriggerNotBreached}, since that is a caller error (check `checkTrigger` first).
    function _validateTrigger(TpSlOrder memory order) internal view returns (bool) {
        // Read current spot price (only the tick is needed; the other getSlot0 outputs are intentionally unused).
        // slither-disable-next-line unused-return
        (, int24 tick,,) = poolManager.getSlot0(order.poolKey.toId());
        uint256 spotPriceX18 = _tickToPriceX18(tick);

        // Read TWAP from AetherHook — an oracle failure means the trigger cannot be
        // verified, so signal a skip rather than propagating the revert.
        uint256 twapPriceX18 = 0;
        try aetherHook.getCurrentTwap(PoolId.unwrap(order.poolKey.toId()), order.twapWindow) returns (uint256 price) {
            twapPriceX18 = price;
        } catch {
            return false;
        }

        // Dual trigger: BOTH spot AND TWAP must breach
        if (!_evaluateTrigger(order, spotPriceX18, twapPriceX18)) {
            revert TriggerNotBreached();
        }
        return true;
    }

    function _evaluateTrigger(TpSlOrder memory order, uint256 spotPriceX18, uint256 twapPriceX18)
        internal
        pure
        returns (bool)
    {
        // orderType is an enum dispatch, not a balance/wei value — the strict equality is intentional and safe.
        // slither-disable-next-line incorrect-equality
        if (order.orderType == OrderType.TAKE_PROFIT) {
            if (order.zeroForOne) {
                return spotPriceX18 <= order.triggerPriceX18 && twapPriceX18 <= order.triggerPriceX18;
            } else {
                return spotPriceX18 >= order.triggerPriceX18 && twapPriceX18 >= order.triggerPriceX18;
            }
        } else {
            if (order.zeroForOne) {
                return spotPriceX18 >= order.triggerPriceX18 && twapPriceX18 >= order.triggerPriceX18;
            } else {
                return spotPriceX18 <= order.triggerPriceX18 && twapPriceX18 <= order.triggerPriceX18;
            }
        }
    }

    // ── Uniswap V4 Router callbacks ────────────────────────────────────────

    enum Action {
        SWAP_EXACT_IN
    }

    function unlockCallback(bytes calldata data) external override returns (bytes memory) {
        if (msg.sender != address(poolManager)) revert Errors.Unauthorized();

        (Action action, bytes memory actionData) = abi.decode(data, (Action, bytes));

        if (action == Action.SWAP_EXACT_IN) {
            (PoolKey memory poolKey, SwapParams memory swapParams, bytes memory hookData, address proceedsRecipient) =
                abi.decode(actionData, (PoolKey, SwapParams, bytes, address));
            return _handleSwapExactIn(poolKey, swapParams, hookData, proceedsRecipient);
        }

        revert Errors.InvalidAction();
    }

    function _handleSwapExactIn(
        PoolKey memory poolKey,
        SwapParams memory swapParams,
        bytes memory hookData,
        address proceedsRecipient
    ) internal returns (bytes memory) {
        if (swapParams.amountSpecified >= 0) revert InvalidAmount();
        uint256 amountIn = uint256(-swapParams.amountSpecified);

        BalanceDelta delta = poolManager.swap(poolKey, swapParams, hookData);

        // Settle input token
        Currency currencyIn = swapParams.zeroForOne ? poolKey.currency0 : poolKey.currency1;
        poolManager.sync(currencyIn);
        IERC20(Currency.unwrap(currencyIn)).safeTransfer(address(poolManager), amountIn);
        // settle()'s return (amount settled) is intentionally unused — the PoolManager enforces delta accounting.
        // slither-disable-next-line unused-return
        poolManager.settle();

        // Take output token DIRECTLY to the recipient (the order owner) — non-custodial:
        // this contract never holds, and never re-routes, the swap proceeds.
        Currency currencyOut = swapParams.zeroForOne ? poolKey.currency1 : poolKey.currency0;
        uint256 amountOut = swapParams.zeroForOne ? uint256(int256(delta.amount1())) : uint256(int256(delta.amount0()));
        if (amountOut > 0) {
            poolManager.take(currencyOut, proceedsRecipient, amountOut);
        }

        return abi.encode(delta);
    }

    // ── Helpers ────────────────────────────────────────────────────────────

    /// @dev V4 core rejects limits AT the boundaries, not beyond them: Pool.swap reverts
    ///      PriceLimitOutOfBounds when `sqrtPriceLimitX96 <= TickMath.MIN_SQRT_PRICE`
    ///      (zeroForOne) or `>= TickMath.MAX_SQRT_PRICE` (oneForZero). The nearest accepted
    ///      limits are therefore MIN_SQRT_PRICE + 1 / MAX_SQRT_PRICE - 1.
    function _sqrtPriceLimit(bool zeroForOne) internal pure returns (uint160) {
        return zeroForOne ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1;
    }

    function _tickToPriceX18(int24 tick) internal pure returns (uint256) {
        uint160 sqrtPriceX96 = TickMath.getSqrtPriceAtTick(tick);
        uint256 priceX96 = FullMath.mulDiv(uint256(sqrtPriceX96), uint256(sqrtPriceX96), FixedPoint96.Q96);
        return FullMath.mulDiv(priceX96, 1e18, FixedPoint96.Q96);
    }
}
