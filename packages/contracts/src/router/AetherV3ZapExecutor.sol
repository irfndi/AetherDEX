// SPDX-License-Identifier: MIT
pragma solidity ^0.8.36;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Errors} from "../lib/Errors.sol";

interface IV3SwapRouter {
    struct ExactInputSingleParams {
        address tokenIn;
        address tokenOut;
        uint24 fee;
        address recipient;
        uint256 deadline;
        uint256 amountIn;
        uint256 amountOutMinimum;
        uint160 sqrtPriceLimitX96;
    }

    function exactInputSingle(ExactInputSingleParams calldata params) external returns (uint256 amountOut);
}

interface IV3PositionManager {
    struct MintParams {
        address token0;
        address token1;
        uint24 fee;
        int24 tickLower;
        int24 tickUpper;
        uint256 amount0Desired;
        uint256 amount1Desired;
        uint256 amount0Min;
        uint256 amount1Min;
        address recipient;
        uint256 deadline;
    }

    function mint(MintParams calldata params)
        external
        returns (uint256 tokenId, uint128 liquidity, uint256 amount0, uint256 amount1);
}

contract AetherV3ZapExecutor is ReentrancyGuard, Ownable {
    using SafeERC20 for IERC20;

    IV3SwapRouter public immutable swapRouter;
    IV3PositionManager public immutable positionManager;

    event ZapExecuted(
        address indexed account,
        uint256 indexed tokenId,
        address tokenIn,
        uint256 amountIn,
        uint256 amountOut,
        uint256 amount0,
        uint256 amount1
    );

    struct SingleSidedZapParams {
        address token0;
        address token1;
        address tokenIn;
        uint24 fee;
        int24 tickLower;
        int24 tickUpper;
        uint256 amountIn;
        uint256 swapAmountIn;
        uint256 minSwapAmountOut;
        uint256 amount0Min;
        uint256 amount1Min;
        uint160 sqrtPriceLimitX96;
        uint256 deadline;
    }

    constructor(IV3SwapRouter _swapRouter, IV3PositionManager _positionManager) Ownable(msg.sender) {
        if (address(_swapRouter) == address(0) || address(_positionManager) == address(0)) revert Errors.ZeroAddress();
        swapRouter = _swapRouter;
        positionManager = _positionManager;
    }

    /// @notice Execute a single-sided zap: pull one token, swap part of it, mint a position.
    /// @dev Dust-tolerant: any token0/token1 balance already held by this contract (e.g. a
    ///      1-wei donation) is snapshotted up front and left untouched. Only the DELTA this
    ///      zap introduces is refunded to the caller, so pre-existing dust can never brick
    ///      the executor. Stranded balances stay recoverable via {rescueTokens}.
    function zap(SingleSidedZapParams calldata params)
        external
        nonReentrant
        returns (uint256 tokenId, uint128 liquidity, uint256 amount0, uint256 amount1, uint256 amountOut)
    {
        _validate(params);
        IERC20 token0 = IERC20(params.token0);
        IERC20 token1 = IERC20(params.token1);
        IERC20 tokenIn = IERC20(params.tokenIn);

        // Snapshot balances BEFORE the zap so the refund step returns only what this zap
        // leaves behind — never pre-existing dust, which belongs outside the zap's books.
        uint256 balance0Before = token0.balanceOf(address(this));
        uint256 balance1Before = token1.balanceOf(address(this));

        uint256 balanceInBefore = tokenIn == token0 ? balance0Before : balance1Before;
        tokenIn.safeTransferFrom(msg.sender, address(this), params.amountIn);
        if (tokenIn.balanceOf(address(this)) - balanceInBefore != params.amountIn) revert Errors.InvalidAmount();

        tokenIn.forceApprove(address(swapRouter), params.swapAmountIn);
        amountOut = swapRouter.exactInputSingle(
            IV3SwapRouter.ExactInputSingleParams({
                tokenIn: params.tokenIn,
                tokenOut: params.tokenIn == params.token0 ? params.token1 : params.token0,
                fee: params.fee,
                recipient: address(this),
                deadline: params.deadline,
                amountIn: params.swapAmountIn,
                amountOutMinimum: params.minSwapAmountOut,
                sqrtPriceLimitX96: params.sqrtPriceLimitX96
            })
        );
        if (amountOut < params.minSwapAmountOut) {
            revert Errors.SlippageExceeded(params.minSwapAmountOut, amountOut);
        }

        uint256 remainingInput = params.amountIn - params.swapAmountIn;
        uint256 amount0Desired = params.tokenIn == params.token0 ? remainingInput : amountOut;
        uint256 amount1Desired = params.tokenIn == params.token0 ? amountOut : remainingInput;
        token0.forceApprove(address(positionManager), amount0Desired);
        token1.forceApprove(address(positionManager), amount1Desired);
        (tokenId, liquidity, amount0, amount1) = positionManager.mint(
            IV3PositionManager.MintParams({
                token0: params.token0,
                token1: params.token1,
                fee: params.fee,
                tickLower: params.tickLower,
                tickUpper: params.tickUpper,
                amount0Desired: amount0Desired,
                amount1Desired: amount1Desired,
                amount0Min: params.amount0Min,
                amount1Min: params.amount1Min,
                recipient: msg.sender,
                deadline: params.deadline
            })
        );
        token0.forceApprove(address(positionManager), 0);
        token1.forceApprove(address(positionManager), 0);
        tokenIn.forceApprove(address(swapRouter), 0);
        _refundDelta(token0, balance0Before);
        _refundDelta(token1, balance1Before);
        emit ZapExecuted(msg.sender, tokenId, params.tokenIn, params.amountIn, amountOut, amount0, amount1);
    }

    /// @notice Sweep tokens stranded in this contract (direct donations, abandoned dust).
    /// @dev Owner-only. `zap` is nonReentrant, so no caller's zap funds can be in flight
    ///      when a rescue runs — any balance here is outside a zap's accounting.
    /// @param token The ERC-20 token to sweep
    /// @param to Recipient of the swept tokens
    /// @param amount Amount to sweep
    function rescueTokens(address token, address to, uint256 amount) external onlyOwner {
        if (to == address(0)) revert Errors.ZeroAddress();
        IERC20(token).safeTransfer(to, amount);
    }

    function _validate(SingleSidedZapParams calldata params) private view {
        if (block.timestamp > params.deadline) revert Errors.DeadlineExpired();
        if (params.token0 == address(0) || params.token1 == address(0) || params.tokenIn == address(0)) {
            revert Errors.ZeroAddress();
        }
        if (params.token0 >= params.token1 || params.token0 == params.token1) revert Errors.InvalidPair();
        if (params.tokenIn != params.token0 && params.tokenIn != params.token1) revert Errors.InvalidPair();
        if (params.fee == 0 || params.fee > 1_000_000) revert Errors.InvalidFee();
        if (params.tickLower >= params.tickUpper) revert Errors.InvalidTickRange();
        if (params.amountIn == 0 || params.minSwapAmountOut == 0) revert Errors.ZeroAmount();
        if (params.swapAmountIn == 0 || params.swapAmountIn >= params.amountIn) revert Errors.InvalidSwapAmount();
    }

    /// @dev Refund the caller only the delta this zap left behind — anything above the
    ///      pre-zap snapshot. Pre-existing dust stays in the contract (owner-recoverable
    ///      via {rescueTokens}) and is never swept into a zap caller's refund.
    function _refundDelta(IERC20 token, uint256 balanceBefore) private {
        uint256 balance = token.balanceOf(address(this));
        if (balance > balanceBefore) token.safeTransfer(msg.sender, balance - balanceBefore);
    }
}
