// SPDX-License-Identifier: MIT
pragma solidity ^0.8.36;

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
///
///      Phase 4 (monetization): charges a flat, IMMUTABLE protocol ENTRY fee
///      ({PROTOCOL_FEE_BPS} = 10 bps = 0.1%) on liquidity deposits (addLiquidity /
///      addLiquiditySingleSided), transferred non-custodially and directly from the
///      user-provided input to the immutable {treasury}. The router never retains fee
///      balances and exposes NO admin surface to mutate the fee rate or the treasury.
///      Swaps, removeLiquidity, rebalance, and TP/SL execution remain fee-free.
contract AetherRouter is IUnlockCallback, Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;
    using CurrencyLibrary for Currency;
    using PoolIdLibrary for PoolKey;

    // ── Protocol entry fee (Phase 4 monetization — immutable, no admin setter) ───

    /// @notice Flat protocol entry fee charged on liquidity deposits: 10 bps = 0.1%
    /// @dev Hard-coded constant — deliberately NOT owner-adjustable. Changing the rate
    ///      requires a redeploy (locked owner decision: flat 0.1% to treasury, no token).
    uint24 public constant PROTOCOL_FEE_BPS = 10;

    /// @notice Basis-point denominator for fee math
    uint256 internal constant BPS_DENOMINATOR = 10_000;

    /// @notice Immutable treasury that receives protocol entry fees via direct transfer
    address public immutable treasury;

    // ── Internal action dispatch tag ──────────────────────────────────────────
    enum Action {
        SWAP_EXACT_IN,
        SWAP_EXACT_OUT,
        ADD_LIQUIDITY,
        REMOVE_LIQUIDITY,
        ADD_LIQUIDITY_SINGLE_SIDED
    }

    // ── Immutables ────────────────────────────────────────────────────────────
    IPoolManager public immutable poolManager;
    IAetherFactory public immutable factory;
    mapping(bytes32 positionId => address owner) public positionOwner;
    mapping(bytes32 positionId => uint256 liquidity) public positionLiquidity;

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

    struct SingleSidedLiquidityParams {
        PoolKey poolKey;
        ModifyLiquidityParams liquidityParams;
        bool zeroForOne;
        uint128 amountIn;
        uint128 swapAmountIn;
        uint128 minSwapAmountOut;
        uint256 minAmount0;
        uint256 minAmount1;
        uint256 deadline;
        bytes hookData;
    }

    // ── Events ────────────────────────────────────────────────────────────────

    event Swap(
        address indexed sender, address indexed tokenIn, address indexed tokenOut, uint256 amountIn, uint256 amountOut
    );

    event LiquidityAdded(address indexed provider, bytes32 indexed poolId, uint256 amount0, uint256 amount1);

    event LiquidityRemoved(address indexed provider, bytes32 indexed poolId, uint256 amount0, uint256 amount1);

    /// @notice Emitted when the flat protocol entry fee is transferred to the treasury
    ///         on a liquidity deposit (one event per charged input token)
    event ProtocolFeeCharged(address indexed token, uint256 amount, address indexed treasury);

    // ── Constructor ───────────────────────────────────────────────────────────

    /// @param _poolManager The Uniswap V4 PoolManager
    /// @param _factory The AetherDEX pool factory
    /// @param _treasury Immutable recipient of the flat protocol entry fee (non-zero)
    /// @param _initialOwner Initial contract owner (no fee/treasury admin exists; retained
    ///        for future router governance, e.g. position-manager migration)
    constructor(IPoolManager _poolManager, IAetherFactory _factory, address _treasury, address _initialOwner)
        Ownable(_initialOwner)
    {
        if (address(_poolManager) == address(0)) revert Errors.ZeroAddress();
        if (address(_factory) == address(0)) revert Errors.ZeroAddress();
        if (_treasury == address(0)) revert Errors.ZeroAddress();
        poolManager = _poolManager;
        factory = _factory;
        treasury = _treasury;
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //  USER-FACING FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════════════

    /// @notice Execute an exact-input swap
    /// @dev Pulls input tokens from sender, executes swap via PoolManager, forwards output
    /// @param params Swap parameters: pool, direction, amountIn, minAmountOut, deadline
    /// @return amountOut The actual output tokens received by the caller
    function swapExactTokensForTokens(SwapExactInParams calldata params)
        external
        nonReentrant
        returns (uint256 amountOut)
    {
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
        if (amountOut > type(uint128).max) revert Errors.InvalidAmount();

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
    function swapExactTokensForTokensOut(SwapExactOutParams calldata params)
        external
        nonReentrant
        returns (uint256 amountIn)
    {
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
    /// @dev Pulls both tokens, charges the flat protocol entry fee on the pulled input
    ///      (transferred directly to {treasury}), executes modifyLiquidity with the net
    ///      amounts, and refunds unused net tokens. The fee is charged on the gross input
    ///      the user presents, so the liquidity operation + refund ceiling consume exactly
    ///      `amount0Max - fee0` / `amount1Max - fee1`.
    /// @param poolKey The pool to add liquidity to
    /// @param params Liquidity parameters: tickLower, tickUpper, liquidityDelta, salt
    /// @param amount0Max Maximum token0 to pull from user (gross of the entry fee)
    /// @param amount1Max Maximum token1 to pull from user (gross of the entry fee)
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
        if (params.liquidityDelta <= 0) revert Errors.InvalidLiquidityDelta();

        bytes32 positionId = _positionId(poolKey, params);
        if (positionOwner[positionId] != address(0)) revert Errors.PositionAlreadyOwned();

        address token0 = Currency.unwrap(poolKey.currency0);
        address token1 = Currency.unwrap(poolKey.currency1);

        // Pull both tokens from user
        IERC20(token0).safeTransferFrom(msg.sender, address(this), amount0Max);
        IERC20(token1).safeTransferFrom(msg.sender, address(this), amount1Max);

        // Charge the flat protocol entry fee on the gross input BEFORE the liquidity
        // operation; the net amounts fund the mint and bound the user's refund.
        uint256 netAmount0 = _chargeEntryFee(token0, amount0Max);
        uint256 netAmount1 = _chargeEntryFee(token1, amount1Max);

        // Unlock PoolManager
        bytes memory result =
            poolManager.unlock(abi.encode(Action.ADD_LIQUIDITY, abi.encode(poolKey, params, netAmount0, netAmount1)));

        delta = abi.decode(result, (BalanceDelta));
        positionOwner[positionId] = msg.sender;
        positionLiquidity[positionId] = uint256(params.liquidityDelta);

        // Refund unused NET tokens to user (the entry fee already left for the treasury,
        // so the router never retains fee balances; settlement inside the callback reverts
        // if the mint owes more than the net deposit).
        uint256 used0 = uint256(-int256(delta.amount0()));
        uint256 used1 = uint256(-int256(delta.amount1()));
        if (used0 < netAmount0) {
            IERC20(token0).safeTransfer(msg.sender, netAmount0 - used0);
        }
        if (used1 < netAmount1) {
            IERC20(token1).safeTransfer(msg.sender, netAmount1 - used1);
        }

        emit LiquidityAdded(msg.sender, PoolId.unwrap(poolKey.toId()), used0, used1);
    }

    /// @notice Deposit one token, swap part of it, and add concentrated liquidity atomically.
    /// @dev Charges the flat protocol entry fee on the gross `amountIn` BEFORE the swap/mint;
    ///      the net amount funds the swap + liquidity, so `swapAmountIn` must fit within the
    ///      post-fee deposit. Positions are protected by the router ownership ledger until
    ///      native V4 PositionManager integration.
    function addLiquiditySingleSided(SingleSidedLiquidityParams calldata params)
        external
        nonReentrant
        returns (BalanceDelta delta, uint256 amountOut)
    {
        if (block.timestamp > params.deadline) revert Errors.DeadlineExpired();
        if (params.amountIn == 0 || params.swapAmountIn == 0) revert Errors.ZeroAmount();
        if (params.swapAmountIn > params.amountIn) revert Errors.InvalidAmount();
        if (params.liquidityParams.liquidityDelta <= 0) revert Errors.InvalidLiquidityDelta();
        if (params.poolKey.currency0.isAddressZero() || params.poolKey.currency1.isAddressZero()) {
            revert Errors.UnsupportedNativeCurrency();
        }

        bytes32 positionId = _positionId(params.poolKey, params.liquidityParams);
        if (positionOwner[positionId] != address(0)) revert Errors.PositionAlreadyOwned();

        address tokenIn = Currency.unwrap(params.zeroForOne ? params.poolKey.currency0 : params.poolKey.currency1);
        uint256 balance0Before = IERC20(Currency.unwrap(params.poolKey.currency0)).balanceOf(address(this));
        uint256 balance1Before = IERC20(Currency.unwrap(params.poolKey.currency1)).balanceOf(address(this));
        IERC20(tokenIn).safeTransferFrom(msg.sender, address(this), params.amountIn);

        // Charge the flat protocol entry fee on the gross input BEFORE the swap/mint; the
        // swap target must fit within the post-fee deposit (net = gross - fee < gross).
        uint256 netAmountIn = _chargeEntryFee(tokenIn, params.amountIn);
        if (params.swapAmountIn > netAmountIn) revert Errors.InvalidAmount();

        bytes memory result = poolManager.unlock(
            abi.encode(Action.ADD_LIQUIDITY_SINGLE_SIDED, abi.encode(params, balance0Before, balance1Before))
        );
        (delta, amountOut) = abi.decode(result, (BalanceDelta, uint256));
        if (amountOut < params.minSwapAmountOut) {
            revert Errors.SlippageExceeded(params.minSwapAmountOut, amountOut);
        }

        uint256 used0 = uint256(-int256(delta.amount0()));
        uint256 used1 = uint256(-int256(delta.amount1()));
        if (used0 < params.minAmount0 || used1 < params.minAmount1) {
            revert Errors.SlippageExceeded(
                params.minAmount0 > params.minAmount1 ? params.minAmount0 : params.minAmount1,
                used0 > used1 ? used0 : used1
            );
        }

        positionOwner[positionId] = msg.sender;
        positionLiquidity[positionId] = uint256(params.liquidityParams.liquidityDelta);
        _refundSingleSidedDust(params.poolKey, msg.sender, balance0Before, balance1Before);
        emit LiquidityAdded(msg.sender, PoolId.unwrap(params.poolKey.toId()), used0, used1);
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
        if (params.liquidityDelta >= 0) revert Errors.InvalidLiquidityDelta();

        bytes32 positionId = _positionId(poolKey, params);
        if (positionOwner[positionId] != msg.sender) revert Errors.UnauthorizedPosition();

        address token0 = Currency.unwrap(poolKey.currency0);
        address token1 = Currency.unwrap(poolKey.currency1);

        // Unlock PoolManager
        bytes memory result = poolManager.unlock(abi.encode(Action.REMOVE_LIQUIDITY, abi.encode(poolKey, params)));

        delta = abi.decode(result, (BalanceDelta));

        uint256 received0 = uint256(int256(delta.amount0()));
        uint256 received1 = uint256(int256(delta.amount1()));

        // Slippage check
        if (received0 < minAmount0 || received1 < minAmount1) {
            revert Errors.SlippageExceeded(
                minAmount0 > minAmount1 ? minAmount0 : minAmount1, received0 > received1 ? received0 : received1
            );
        }

        uint256 removedLiquidity = uint256(-params.liquidityDelta);
        uint256 currentLiquidity = positionLiquidity[positionId];
        if (removedLiquidity >= currentLiquidity) {
            delete positionOwner[positionId];
            delete positionLiquidity[positionId];
        } else {
            positionLiquidity[positionId] = currentLiquidity - removedLiquidity;
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
            (PoolKey memory pKey, ModifyLiquidityParams memory liqP) =
                abi.decode(actionData, (PoolKey, ModifyLiquidityParams));
            return _handleRemoveLiquidity(pKey, liqP);
        } else if (action == Action.ADD_LIQUIDITY_SINGLE_SIDED) {
            (SingleSidedLiquidityParams memory params, uint256 balance0Before, uint256 balance1Before) =
                abi.decode(actionData, (SingleSidedLiquidityParams, uint256, uint256));
            return _handleAddLiquiditySingleSided(params, balance0Before, balance1Before);
        }

        revert Errors.InvalidPath();
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //  INTERNAL HANDLERS (called inside unlockCallback)
    // ═══════════════════════════════════════════════════════════════════════════

    function _handleSwapExactIn(SwapExactInParams memory params) internal returns (bytes memory) {
        SwapParams memory swapParams = SwapParams({
            zeroForOne: params.zeroForOne,
            amountSpecified: int256(int128(params.amountIn)),
            sqrtPriceLimitX96: _sqrtPriceLimit(params.zeroForOne)
        });

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
        SwapParams memory swapParams = SwapParams({
            zeroForOne: params.zeroForOne,
            amountSpecified: -int256(int128(params.amountOut)),
            sqrtPriceLimitX96: _sqrtPriceLimit(params.zeroForOne)
        });

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

    function _handleAddLiquidity(PoolKey memory poolKey, ModifyLiquidityParams memory liqParams)
        internal
        returns (bytes memory)
    {
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

    function _handleRemoveLiquidity(PoolKey memory poolKey, ModifyLiquidityParams memory liqParams)
        internal
        returns (bytes memory)
    {
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

    function _handleAddLiquiditySingleSided(
        SingleSidedLiquidityParams memory params,
        uint256 balance0Before,
        uint256 balance1Before
    ) internal returns (bytes memory) {
        SwapParams memory swapParams = SwapParams({
            zeroForOne: params.zeroForOne,
            amountSpecified: -int256(int128(params.swapAmountIn)),
            sqrtPriceLimitX96: _sqrtPriceLimit(params.zeroForOne)
        });
        BalanceDelta swapDelta = poolManager.swap(params.poolKey, swapParams, params.hookData);

        Currency currencyIn = params.zeroForOne ? params.poolKey.currency0 : params.poolKey.currency1;
        uint256 actualAmountIn =
            params.zeroForOne ? uint256(-int256(swapDelta.amount0())) : uint256(-int256(swapDelta.amount1()));
        if (actualAmountIn > params.swapAmountIn) revert Errors.InvalidAmount();
        poolManager.sync(currencyIn);
        IERC20(Currency.unwrap(currencyIn)).safeTransfer(address(poolManager), actualAmountIn);
        poolManager.settle();

        Currency currencyOut = params.zeroForOne ? params.poolKey.currency1 : params.poolKey.currency0;
        uint256 amountOut =
            params.zeroForOne ? uint256(int256(swapDelta.amount1())) : uint256(int256(swapDelta.amount0()));
        if (amountOut > 0) poolManager.take(currencyOut, address(this), amountOut);

        (BalanceDelta liquidityDelta,) = poolManager.modifyLiquidity(params.poolKey, params.liquidityParams, "");
        _settleLiquidityDeltas(params.poolKey, liquidityDelta, balance0Before, balance1Before);
        return abi.encode(liquidityDelta, amountOut);
    }

    function _settleLiquidityDeltas(
        PoolKey memory poolKey,
        BalanceDelta delta,
        uint256 balance0Before,
        uint256 balance1Before
    ) internal {
        uint256 owed0 = uint256(-int256(delta.amount0()));
        uint256 owed1 = uint256(-int256(delta.amount1()));
        _settleCallScoped(poolKey.currency0, owed0, balance0Before);
        _settleCallScoped(poolKey.currency1, owed1, balance1Before);
    }

    function _settleCallScoped(Currency currency, uint256 amount, uint256 balanceBefore) internal {
        if (amount == 0) return;
        uint256 balanceAfter = IERC20(Currency.unwrap(currency)).balanceOf(address(this));
        if (balanceAfter < balanceBefore || balanceAfter - balanceBefore < amount) {
            revert Errors.InsufficientCallBalance();
        }
        poolManager.sync(currency);
        IERC20(Currency.unwrap(currency)).safeTransfer(address(poolManager), amount);
        poolManager.settle();
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //  HELPERS
    // ═══════════════════════════════════════════════════════════════════════════

    /// @dev Returns the appropriate sqrt price limit for the swap direction
    function _sqrtPriceLimit(bool zeroForOne) internal pure returns (uint160) {
        return zeroForOne ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1;
    }

    /// @notice Charge the flat protocol entry fee on a deposit input amount
    /// @dev Transfers the fee DIRECTLY from the already-pulled input to the immutable
    ///      {treasury} (non-custodial: the router never retains fee balances) and returns
    ///      the net amount available to the liquidity operation. ERC20-only: both deposit
    ///      entry points gate native currency (single-sided explicitly, double-sided by
    ///      ERC20 settlement), so no native fee path is needed. No-op (zero fee) when
    ///      `amountIn` is too small for a full basis-point slice.
    /// @param token The deposit input token (ERC20)
    /// @param amountIn The gross input amount pulled from the user
    /// @return amountAfterFee The input net of the entry fee
    function _chargeEntryFee(address token, uint256 amountIn) internal returns (uint256 amountAfterFee) {
        uint256 fee = (amountIn * PROTOCOL_FEE_BPS) / BPS_DENOMINATOR;
        amountAfterFee = amountIn - fee;
        if (fee > 0) {
            IERC20(token).safeTransfer(treasury, fee);
            emit ProtocolFeeCharged(token, fee, treasury);
        }
    }

    function _positionId(PoolKey calldata poolKey, ModifyLiquidityParams calldata params)
        internal
        pure
        returns (bytes32)
    {
        return keccak256(abi.encode(poolKey.toId(), params.tickLower, params.tickUpper, params.salt));
    }

    function _refundSingleSidedDust(
        PoolKey calldata poolKey,
        address recipient,
        uint256 balance0Before,
        uint256 balance1Before
    ) internal {
        address token0 = Currency.unwrap(poolKey.currency0);
        address token1 = Currency.unwrap(poolKey.currency1);
        uint256 balance0After = IERC20(token0).balanceOf(address(this));
        uint256 balance1After = IERC20(token1).balanceOf(address(this));
        uint256 balance0 = balance0After > balance0Before ? balance0After - balance0Before : 0;
        uint256 balance1 = balance1After > balance1Before ? balance1After - balance1Before : 0;
        if (balance0 > 0) IERC20(token0).safeTransfer(recipient, balance0);
        if (balance1 > 0) IERC20(token1).safeTransfer(recipient, balance1);
    }

    /// @notice Receive ETH (in case someone sends it accidentally)
    receive() external payable {}
}
