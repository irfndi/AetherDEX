// SPDX-License-Identifier: GPL-3.0

/*
Created by irfndi (github.com/irfndi) - Apr 2025
Email: join.mantap@gmail.com
*/

pragma solidity ^0.8.31;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IAetherPool} from "../interfaces/IAetherPool.sol";
import {BaseRouter} from "./BaseRouter.sol";
import {IERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Permit.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Errors} from "../libraries/Errors.sol";
import {AetherFactory} from "./AetherFactory.sol";

/**
 * @title AetherRouter (Simplified)
 * @notice Handles interactions with AetherPool instances for swaps and liquidity.
 * @dev Assumes pools are already deployed. Caller must approve pool tokens.
 */
contract AetherRouter is BaseRouter {
    using SafeERC20 for IERC20;

    AetherFactory public immutable factory;

    constructor(address _factory) {
        factory = AetherFactory(_factory);
    }

    // **** ADD LIQUIDITY ****
    function _addLiquidity(
        address tokenA,
        address tokenB,
        uint256 amountADesired,
        uint256 amountBDesired,
        uint256 amountAMin,
        uint256 amountBMin
    ) internal virtual returns (uint256 amountA, uint256 amountB, address pool) {
        // Create pool if it doesn't exist? No, this router assumes pools exist or use createPool.
        // Assuming 3000 fee for lookup default or we iterate?
        // For simplicity, we check standard fee 0.3% (3000)
        pool = factory.getPoolAddress(tokenA, tokenB, 3000);
        if (pool == address(0)) {
            // Try enabling pool creation here? No, stick to prompt "Simplified".
            revert Errors.PoolNotFound();
        }

        (uint256 reserveA, uint256 reserveB) = getReserves(pool, tokenA, tokenB);
        if (reserveA == 0 && reserveB == 0) {
            (amountA, amountB) = (amountADesired, amountBDesired);
        } else {
            uint256 amountBOptimal = quote(amountADesired, reserveA, reserveB);
            if (amountBOptimal <= amountBDesired) {
                require(amountBOptimal >= amountBMin, "INSUFFICIENT_B_AMOUNT");
                (amountA, amountB) = (amountADesired, amountBOptimal);
            } else {
                uint256 amountAOptimal = quote(amountBDesired, reserveB, reserveA);
                assert(amountAOptimal <= amountADesired);
                require(amountAOptimal >= amountAMin, "INSUFFICIENT_A_AMOUNT");
                (amountA, amountB) = (amountAOptimal, amountBDesired);
            }
        }
    }

    function addLiquidity(
        address tokenA,
        address tokenB,
        uint256 amountADesired,
        uint256 amountBDesired,
        uint256 amountAMin,
        uint256 amountBMin,
        address to,
        uint256 deadline
    ) external nonReentrant checkDeadline(deadline) returns (uint256 amountA, uint256 amountB, uint256 liquidity) {
        address pool;
        (amountA, amountB, pool) = _addLiquidity(tokenA, tokenB, amountADesired, amountBDesired, amountAMin, amountBMin);

        IERC20(tokenA).safeTransferFrom(msg.sender, pool, amountA);
        IERC20(tokenB).safeTransferFrom(msg.sender, pool, amountB);

        // Check total supply. If 0, it means we are initializing.
        // However, Vyper pool's totalSupply might be 0 even if initialized if all liquidity was burned (edge case).
        // But AetherPool.vy checks initialized state.
        // Ideally we check IAetherPool(pool).totalSupply().
        if (IAetherPool(pool).totalSupply() == 0) {
            liquidity = IAetherPool(pool).addInitialLiquidity(amountA, amountB);
            // Initial liquidity is minted to msg.sender (this router), so we must forward it to the user
            if (to != address(this)) {
                IERC20(pool).safeTransfer(to, liquidity);
            }
        } else {
            (,, liquidity) = IAetherPool(pool).addLiquidityNonInitial(to, amountA, amountB, "");
        }
    }

    function removeLiquidity(
        address pool,
        uint256 liquidity,
        uint256 amountAMin,
        uint256 amountBMin,
        address to,
        uint256 deadline
    ) external nonReentrant checkDeadline(deadline) returns (uint256 amountA, uint256 amountB) {
        if (pool == address(0)) revert Errors.InvalidPoolAddress();
        _transferToPool(pool, pool, liquidity);
        (amountA, amountB) = IAetherPool(pool).burn(to, liquidity);
        if (amountA < amountAMin) {
            revert Errors.InsufficientAAmount();
        }
        if (amountB < amountBMin) {
            revert Errors.InsufficientBAmount();
        }
    }

    function swapExactTokensForTokens(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external nonReentrant checkDeadline(deadline) returns (uint256[] memory amounts) {
        if (path.length < 2) revert Errors.InvalidPath();

        amounts = getAmountsOut(factory, amountIn, path);
        if (amounts[amounts.length - 1] < amountOutMin) {
            revert Errors.InsufficientOutputAmount();
        }

        // Transfer first input to first pool
        address pool = factory.getPoolAddress(path[0], path[1], 3000); // Assuming 3000 fee for now
        if (pool == address(0)) revert Errors.PoolNotFound();

        IERC20(path[0]).safeTransferFrom(msg.sender, pool, amounts[0]);

        _swap(amounts, path, to);
    }

    function _swap(uint256[] memory amounts, address[] memory path, address _to) internal virtual {
        for (uint256 i; i < path.length - 1; i++) {
            (address input, address output) = (path[i], path[i + 1]);
            address token0 = input < output ? input : output;
            uint256 amountOut = amounts[i + 1];
            (uint256 amount0Out, uint256 amount1Out) =
                input == token0 ? (uint256(0), amountOut) : (amountOut, uint256(0));
            address to = i < path.length - 2 ? factory.getPoolAddress(output, path[i + 2], 3000) : _to; // Next pool or recipient

            address pool = factory.getPoolAddress(input, output, 3000);

            // Note: IAetherPool.swap signature in Vyper is: swap(amountIn, tokenIn, to) -> amountOut
            // It assumes the tokens are already there. But standard V2 behavior is to call swap(amount0Out, amount1Out, to, data)
            // AetherPool.vy's swap function does:
            // swap(tokenIn, amountIn, to, amountOutMin) -> amountOut
            // And assumes transfer has happened? Wait.

            // Let's check AetherPool.vy's swap.
            // def swap(tokenIn: address, amountIn: uint256, to: address, amountOutMin: uint256) -> uint256:
            // It expects transfer to happen later? No.
            // "Interactions (Transfer output tokens *after* state updates)"
            // But it calculates: amountInWithFee = (amountIn * ...) ...
            // And then updates reserves: new_reserve0 = _reserve0 + amountIn
            // This implies it relies on `amountIn` parameter passed, and assumes reserves haven't been updated yet?
            // "balance0: uint256 = ERC20(self.poolToken0).balanceOf(self)" is NOT called in `swap`.
            // Instead it uses `self.reserve0`.
            // So how does it know `amountIn` was transferred?
            // "Interactions... res: bool = ERC20(tokenOut).transfer(to, amountOut)"
            // Wait, does it pull tokens? No.
            // It does NOT pull tokens in `swap`.
            // So `amountIn` must be sent to the pool beforehand.

            // If I use `swap` from Vyper, I must transfer tokens first (which I did in `swapExactTokensForTokens` above for first hop).
            // But for subsequent hops?
            // Previous pool sends to current pool.

            // AetherPool.vy `swap` expects `amountIn` argument.
            // And it updates reserves assuming that `amountIn` was added to the reserve.
            // It does not verify balance.

            // So:
            // 1. Transfer `amountIn` to pool.
            // 2. Call `pool.swap(tokenIn, amountIn, to, 0)`.

            IAetherPool(pool).swap(amounts[i], input, to);
        }
    }

    function getAmountsOut(AetherFactory _factory, uint256 amountIn, address[] memory path)
        internal
        view
        returns (uint256[] memory amounts)
    {
        if (path.length < 2) revert Errors.InvalidPath();
        amounts = new uint256[](path.length);
        amounts[0] = amountIn;
        for (uint256 i; i < path.length - 1; i++) {
            address pool = _factory.getPoolAddress(path[i], path[i + 1], 3000);
            if (pool == address(0)) revert Errors.PoolNotFound();
            (uint256 reserveIn, uint256 reserveOut) = getReserves(pool, path[i], path[i + 1]);
            amounts[i + 1] = getAmountOut(amounts[i], reserveIn, reserveOut, IAetherPool(pool).fee());
        }
    }

    function getAmountOut(uint256 amountIn, uint256 reserveIn, uint256 reserveOut, uint24 fee)
        internal
        pure
        returns (uint256 amountOut)
    {
        if (amountIn == 0) revert Errors.InvalidAmountIn();
        if (reserveIn == 0 || reserveOut == 0) revert Errors.InsufficientLiquidity();
        uint256 feeDenominator = 1_000_000;
        uint256 amountInWithFee = amountIn * (feeDenominator - fee);
        uint256 numerator = amountInWithFee * reserveOut;
        uint256 denominator = (reserveIn * feeDenominator) + amountInWithFee;
        amountOut = numerator / denominator;
    }

    function getReserves(address pool, address tokenA, address tokenB)
        internal
        view
        returns (uint256 reserveA, uint256 reserveB)
    {
        address token0 = IAetherPool(pool).token0();
        // address token1 = IAetherPool(pool).token1();
        (uint256 reserve0, uint256 reserve1) = (IAetherPool(pool).reserve0(), IAetherPool(pool).reserve1());
        (reserveA, reserveB) = tokenA == token0 ? (reserve0, reserve1) : (reserve1, reserve0);
    }

    function quote(uint256 amountA, uint256 reserveA, uint256 reserveB) internal pure returns (uint256 amountB) {
        require(amountA > 0, "INSUFFICIENT_AMOUNT");
        require(reserveA > 0 && reserveB > 0, "INSUFFICIENT_LIQUIDITY");
        amountB = (amountA * reserveB) / reserveA;
    }

    // Helper function to call permit on a token
    function _permitToken(
        IERC20Permit token,
        address owner,
        address spender,
        uint256 amount,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) private {
        // Cast to IERC20 to call allowance, as IERC20Permit does not define it.
        if (IERC20(address(token)).allowance(owner, spender) < amount) {
            token.permit(owner, spender, amount, deadline, v, r, s);
        }
    }

    function swapExactTokensForTokensWithPermit(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline, // Deadline for the swap itself
        uint256 permitDeadline, // Deadline for the permit signature
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external nonReentrant checkDeadline(deadline) returns (uint256[] memory amounts) {
        if (path.length < 2) revert Errors.InvalidPath();
        address tokenInAddress = path[0];

        // Permit the router to spend tokenIn on behalf of msg.sender
        _permitToken(IERC20Permit(tokenInAddress), msg.sender, address(this), amountIn, permitDeadline, v, r, s);

        amounts = getAmountsOut(factory, amountIn, path);
        if (amounts[amounts.length - 1] < amountOutMin) {
            revert Errors.InsufficientOutputAmount();
        }

        address pool = factory.getPoolAddress(path[0], path[1], 3000);
        if (pool == address(0)) revert Errors.PoolNotFound();

        IERC20(tokenInAddress).safeTransferFrom(msg.sender, pool, amounts[0]);

        _swap(amounts, path, to);
    }

    modifier checkDeadline(uint256 deadline) override {
        if (deadline < block.timestamp) {
            revert Errors.DeadlineExpired();
        }
        _;
    }
}
