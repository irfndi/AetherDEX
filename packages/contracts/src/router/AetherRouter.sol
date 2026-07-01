// SPDX-License-Identifier: MIT
pragma solidity ^0.8.31;

import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {BalanceDelta, BalanceDeltaLibrary} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {Currency, CurrencyLibrary} from "@uniswap/v4-core/src/types/Currency.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {ModifyLiquidityParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {IUnlockCallback} from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Errors} from "../lib/Errors.sol";
import {IAetherFactory} from "../interfaces/IAetherFactory.sol";

/// @title AetherRouter
/// @notice User-facing router for AetherDEX swaps and liquidity operations
/// @dev Wraps Uniswap V4 PoolManager via the unlock/callback pattern.
///      All pool interactions happen inside unlockCallback to ensure proper delta settlement.
contract AetherRouter is IUnlockCallback, Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;
    using CurrencyLibrary for Currency;
    using PoolIdLibrary for PoolKey;

    // ── Internal action dispatch tag ──────────────────────────────────────────
    enum Action {
        SWAP_EXACT_IN,
        SWAP_EXACT_OUT,
        ADD_LIQUIDITY,
        REMOVE_LIQUIDITY
    }

    // ── Immutables ────────────────────────────────────────────────────────────
    IPoolManager public immutable poolManager;
    IAetherFactory public immutable factory;

    // ── User-facing parameter structs ─────────────────────────────────────────

    struct SwapExactInParams {
        PoolKey poolKey;
        bool zeroForOne;
        uint128 amountIn;
        uint128 minAmountOut;
        uint256 deadline;
        bytes hookData;
    }

    struct SwapExactOutParams {
        PoolKey poolKey;
        bool zeroForOne;
        uint128 amountOut;
        uint128 maxAmountIn;
        uint256 deadline;
        bytes hookData;
    }

    // ── Events ────────────────────────────────────────────────────────────────

    event Swap(
        address indexed sender,
        address indexed tokenIn,
        address indexed tokenOut,
        uint256 amountIn,
        uint256 amountOut
    );

    event LiquidityAdded(
        address indexed provider,
        bytes32 indexed poolId,
        uint256 amount0,
        uint256 amount1
    );

    event LiquidityRemoved(
        address indexed provider,
        bytes32 indexed poolId,
        uint256 amount0,
        uint256 amount1
    );

    // ── Constructor ───────────────────────────────────────────────────────────

    constructor(IPoolManager _poolManager, IAetherFactory _factory, address _initialOwner) Ownable(_initialOwner) {
        if (address(_poolManager) == address(0)) revert Errors.ZeroAddress();
        if (address(_factory) == address(0)) revert Errors.ZeroAddress();
        poolManager = _poolManager;
        factory = _factory;
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //  USER-FACING FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════════════

    /// @notice Execute an exact-input swap
    /// @dev Pulls input tokens from sender, executes swap via PoolManager, forwards output
    /// @param params Swap parameters: pool, direction, amountIn, minAmountOut, deadline
    /// @return amountOut The actual output tokens received by the caller
    function swapExactTokensForTokens(SwapExactInParams calldata params) external nonReentrant returns (uint256 amountOut) {
        if (block.timestamp > params.deadline) revert Errors.DeadlineExpired();
        if (params.amountIn == 0) revert Errors.ZeroAmount();

        // Determine token addresses
        address tokenIn = Currency.unwrap(params.zeroForOne ? params.poolKey.currency0 : params.poolKey.currency1);
        address tokenOut = Currency.unwrap(params.zeroForOne ? params.poolKey.currency1 : params.poolKey.currency0);

        // Pull input tokens from user to this contract
        IERC20(tokenIn).safeTransferFrom(msg.sender, address(this), params.amountIn);

        // Unlock PoolManager — triggers unlockCallback
        bytes memory result = poolManager.unlock(abi.encode(Action.SWAP_EXACT_IN, abi.encode(params)));

        // Decode the swap delta returned by the callback
        BalanceDelta delta = abi.decode(result, (BalanceDelta));

        // Compute output amount from delta
        amountOut = params.zeroForOne ? uint256(int256(delta.amount1())) : uint256(int256(delta.amount0()));

        // Revert on uint128 overflow rather than silently clamping.
        // Silent clamping breaks slippage protection and the user's minAmountOut check.
        if (amountOut > type(uint128).max) revert("AetherRouter: amountOut overflows uint128");

        // Slippage check
        if (amountOut < params.minAmountOut) {
            revert Errors.SlippageExceeded(params.minAmountOut, amountOut);
        }

        // Transfer output to user (tokens are already held by this contract from take())
        IERC20(tokenOut).safeTransfer(msg.sender, amountOut);

        emit Swap(msg.sender, tokenIn, tokenOut, params.amountIn, amountOut);
    }

    /// @notice Execute an exact-output swap
    /// @dev Pulls max input from sender, executes swap, refunds excess input
    /// @param params Swap parameters: pool, direction, amountOut, maxAmountIn, deadline
    /// @return amountIn The actual input tokens consumed
    function swapExactTokensForTokensOut(SwapExactOutParams calldata params) external nonReentrant returns (uint256 amountIn) {
        if (block.timestamp > params.deadline) revert Errors.DeadlineExpired();
        if (params.amountOut == 0) revert Errors.ZeroAmount();

        address tokenIn = Currency.unwrap(params.zeroForOne ? params.poolKey.currency0 : params.poolKey.currency1);
        address tokenOut = Currency.unwrap(params.zeroForOne ? params.poolKey.currency1 : params.poolKey.currency0);

        // Pull max input from user
        IERC20(tokenIn).safeTransferFrom(msg.sender, address(this), params.maxAmountIn);

        // Unlock PoolManager
        bytes memory result = poolManager.unlock(abi.encode(Action.SWAP_EXACT_OUT, abi.encode(params)));

        BalanceDelta delta = abi.decode(result, (BalanceDelta));

        // Compute actual input consumed
        amountIn = params.zeroForOne ? uint256(-int256(delta.amount0())) : uint256(-int256(delta.amount1()));

        // Slippage check
        if (amountIn > params.maxAmountIn) {
            revert Errors.SlippageExceeded(params.maxAmountIn, amountIn);
        }

        // Refund excess input to user
        uint256 refund = params.maxAmountIn - amountIn;
        if (refund > 0) {
            IERC20(tokenIn).safeTransfer(msg.sender, refund);
        }

        // Transfer output to user
        IERC20(tokenOut).safeTransfer(msg.sender, params.amountOut);

        emit Swap(msg.sender, tokenIn, tokenOut, amountIn, params.amountOut);
    }

    /// @notice Add concentrated liquidity to a pool
    /// @dev Pulls both tokens, executes modifyLiquidity, refunds unused tokens
    /// @param poolKey The pool to add liquidity to
    /// @param params Liquidity parameters: tickLower, tickUpper, liquidityDelta, salt
    /// @param amount0Max Maximum token0 to pull from user
    /// @param amount1Max Maximum token1 to pull from user
    /// @param deadline Transaction deadline
    /// @return delta The caller's balance delta after adding liquidity
    function addLiquidity(
        PoolKey calldata poolKey,
        ModifyLiquidityParams calldata params,
        uint256 amount0Max,
        uint256 amount1Max,
        uint256 deadline
    ) external nonReentrant returns (BalanceDelta delta) {
        if (block.timestamp > deadline) revert Errors.DeadlineExpired();

        address token0 = Currency.unwrap(poolKey.currency0);
        address token1 = Currency.unwrap(poolKey.currency1);

        // Pull both tokens from user
        IERC20(token0).safeTransferFrom(msg.sender, address(this), amount0Max);
        IERC20(token1).safeTransferFrom(msg.sender, address(this), amount1Max);

        // Unlock PoolManager
        bytes memory result = poolManager.unlock(abi.encode(Action.ADD_LIQUIDITY, abi.encode(poolKey, params, amount0Max, amount1Max)));

        delta = abi.decode(result, (BalanceDelta));

        // Refund unused tokens to user
        uint256 used0 = uint256(-int256(delta.amount0()));
        uint256 used1 = uint256(-int256(delta.amount1()));
        if (used0 < amount0Max) {
            IERC20(token0).safeTransfer(msg.sender, amount0Max - used0);
        }
        if (used1 < amount1Max) {
            IERC20(token1).safeTransfer(msg.sender, amount1Max - used1);
        }

        emit LiquidityAdded(msg.sender, PoolId.unwrap(poolKey.toId()), used0, used1);
    }

    /// @notice Remove concentrated liquidity from a pool
    /// @dev Executes modifyLiquidity with negative delta, transfers tokens to user
    /// @param poolKey The pool to remove liquidity from
    /// @param params Liquidity parameters: tickLower, tickUpper, liquidityDelta (negative), salt
    /// @param minAmount0 Minimum token0 to receive
    /// @param minAmount1 Minimum token1 to receive
    /// @param deadline Transaction deadline
    /// @return delta The caller's balance delta after removing liquidity
    function removeLiquidity(
        PoolKey calldata poolKey,
        ModifyLiquidityParams calldata params,
        uint256 minAmount0,
        uint256 minAmount1,
        uint256 deadline
    ) external nonReentrant returns (BalanceDelta delta) {
        if (block.timestamp > deadline) revert Errors.DeadlineExpired();

        address token0 = Currency.unwrap(poolKey.currency0);
        address token1 = Currency.unwrap(poolKey.currency1);

        // Unlock PoolManager
        bytes memory result = poolManager.unlock(abi.encode(Action.REMOVE_LIQUIDITY, abi.encode(poolKey, params)));

        delta = abi.decode(result, (BalanceDelta));

        uint256 received0 = uint256(int256(delta.amount0()));
        uint256 received1 = uint256(int256(delta.amount1()));

        // Slippage check
        if (received0 < minAmount0 || received1 < minAmount1) {
            revert Errors.SlippageExceeded(minAmount0 > minAmount1 ? minAmount0 : minAmount1, received0 > received1 ? received0 : received1);
        }

        // Transfer tokens to user (already held by this contract from take())
        IERC20(token0).safeTransfer(msg.sender, received0);
        IERC20(token1).safeTransfer(msg.sender, received1);

        emit LiquidityRemoved(msg.sender, PoolId.unwrap(poolKey.toId()), received0, received1);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //  UNLOCK CALLBACK — called by PoolManager
    // ═══════════════════════════════════════════════════════════════════════════

    /// @notice Callback invoked by PoolManager.unlock()
    /// @dev Only callable by the PoolManager. Dispatches to the appropriate handler.
    ///      All pool deltas MUST be settled before returning.
    function unlockCallback(bytes calldata data) external override returns (bytes memory) {
        if (msg.sender != address(poolManager)) revert Errors.Unauthorized();

        (Action action, bytes memory actionData) = abi.decode(data, (Action, bytes));

        if (action == Action.SWAP_EXACT_IN) {
            return _handleSwapExactIn(abi.decode(actionData, (SwapExactInParams)));
        } else if (action == Action.SWAP_EXACT_OUT) {
            return _handleSwapExactOut(abi.decode(actionData, (SwapExactOutParams)));
        } else if (action == Action.ADD_LIQUIDITY) {
            (PoolKey memory pKey, ModifyLiquidityParams memory liqP,,) =
                abi.decode(actionData, (PoolKey, ModifyLiquidityParams, uint256, uint256));
            return _handleAddLiquidity(pKey, liqP);
        } else if (action == Action.REMOVE_LIQUIDITY) {
            (PoolKey memory pKey, ModifyLiquidityParams memory liqP) = abi.decode(actionData, (PoolKey, ModifyLiquidityParams));
            return _handleRemoveLiquidity(pKey, liqP);
        }

        revert Errors.InvalidPath();
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //  INTERNAL HANDLERS (called inside unlockCallback)
    // ═══════════════════════════════════════════════════════════════════════════

    function _handleSwapExactIn(SwapExactInParams memory params) internal returns (bytes memory) {
        SwapParams memory swapParams =
            SwapParams({zeroForOne: params.zeroForOne, amountSpecified: int256(int128(params.amountIn)), sqrtPriceLimitX96: _sqrtPriceLimit(params.zeroForOne)});

        BalanceDelta delta = poolManager.swap(params.poolKey, swapParams, params.hookData);

        // Settle input token: sync → transfer to PM → settle
        Currency currencyIn = params.zeroForOne ? params.poolKey.currency0 : params.poolKey.currency1;
        poolManager.sync(currencyIn);
        IERC20(Currency.unwrap(currencyIn)).safeTransfer(address(poolManager), params.amountIn);
        poolManager.settle();

        // Take output token from PM
        Currency currencyOut = params.zeroForOne ? params.poolKey.currency1 : params.poolKey.currency0;
        uint256 amountOut = params.zeroForOne ? uint256(int256(delta.amount1())) : uint256(int256(delta.amount0()));
        if (amountOut > 0) {
            poolManager.take(currencyOut, address(this), amountOut);
        }

        return abi.encode(delta);
    }

    function _handleSwapExactOut(SwapExactOutParams memory params) internal returns (bytes memory) {
        // For exact-out, amountSpecified is negative
        SwapParams memory swapParams =
            SwapParams({zeroForOne: params.zeroForOne, amountSpecified: -int256(int128(params.amountOut)), sqrtPriceLimitX96: _sqrtPriceLimit(params.zeroForOne)});

        BalanceDelta delta = poolManager.swap(params.poolKey, swapParams, params.hookData);

        // Compute actual input consumed
        uint256 amountIn = params.zeroForOne ? uint256(-int256(delta.amount0())) : uint256(-int256(delta.amount1()));

        // Settle input token
        Currency currencyIn = params.zeroForOne ? params.poolKey.currency0 : params.poolKey.currency1;
        poolManager.sync(currencyIn);
        IERC20(Currency.unwrap(currencyIn)).safeTransfer(address(poolManager), amountIn);
        poolManager.settle();

        // Take output token
        Currency currencyOut = params.zeroForOne ? params.poolKey.currency1 : params.poolKey.currency0;
        poolManager.take(currencyOut, address(this), params.amountOut);

        return abi.encode(delta);
    }

    function _handleAddLiquidity(PoolKey memory poolKey, ModifyLiquidityParams memory liqParams) internal returns (bytes memory) {
        (BalanceDelta callerDelta,) = poolManager.modifyLiquidity(poolKey, liqParams, "");

        // Settle tokens owed to the pool (negative delta = we owe)
        uint256 owed0 = uint256(-int256(callerDelta.amount0()));
        uint256 owed1 = uint256(-int256(callerDelta.amount1()));

        if (owed0 > 0) {
            poolManager.sync(poolKey.currency0);
            IERC20(Currency.unwrap(poolKey.currency0)).safeTransfer(address(poolManager), owed0);
            poolManager.settle();
        }

        if (owed1 > 0) {
            poolManager.sync(poolKey.currency1);
            IERC20(Currency.unwrap(poolKey.currency1)).safeTransfer(address(poolManager), owed1);
            poolManager.settle();
        }

        return abi.encode(callerDelta);
    }

    function _handleRemoveLiquidity(PoolKey memory poolKey, ModifyLiquidityParams memory liqParams) internal returns (bytes memory) {
        (BalanceDelta callerDelta,) = poolManager.modifyLiquidity(poolKey, liqParams, "");

        // Take tokens owed to us (positive delta = pool owes us)
        uint256 received0 = uint256(int256(callerDelta.amount0()));
        uint256 received1 = uint256(int256(callerDelta.amount1()));

        if (received0 > 0) {
            poolManager.take(poolKey.currency0, address(this), received0);
        }

        if (received1 > 0) {
            poolManager.take(poolKey.currency1, address(this), received1);
        }

        return abi.encode(callerDelta);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //  HELPERS
    // ═══════════════════════════════════════════════════════════════════════════

    /// @dev Returns the appropriate sqrt price limit for the swap direction
    function _sqrtPriceLimit(bool zeroForOne) internal pure returns (uint160) {
        return zeroForOne ? TickMath.MIN_SQRT_PRICE : TickMath.MAX_SQRT_PRICE;
    }

    /// @notice Receive ETH (in case someone sends it accidentally)
    receive() external payable {}
}
