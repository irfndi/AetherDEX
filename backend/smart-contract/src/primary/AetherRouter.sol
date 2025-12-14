// SPDX-License-Identifier: GPL-3.0

/*
Created by irfndi (github.com/irfndi) - Apr 2025
Email: join.mantap@gmail.com
*/

pragma solidity ^0.8.29;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IAetherPool} from "../interfaces/IAetherPool.sol";
import {BaseRouter} from "./BaseRouter.sol";
import {IERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Permit.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Errors} from "../libraries/Errors.sol";

/**
 * @title AetherRouter (Simplified)
 * @notice Handles interactions with AetherPool instances for swaps and liquidity.
 * @dev Assumes pools are already deployed. Caller must approve pool tokens.
 */
contract AetherRouter is BaseRouter {
    using SafeERC20 for IERC20;

    // Helper functions for sqrt and min
    function sqrt(uint256 y) internal pure returns (uint256 z) {
        if (y > 3) {
            z = y;
            uint256 x = y / 2 + 1;
            while (x < z) {
                z = x;
                x = (y / x + x) / 2;
            }
        } else if (y != 0) {
            z = 1;
        }
    }

    function min(uint256 x, uint256 y) internal pure returns (uint256 z) {
        z = x < y ? x : y;
    }

    // Helper to calculate optimal amounts
    function _calculateOptimalAmounts(
        uint256 amountADesired,
        uint256 amountBDesired,
        uint256 amountAMin,
        uint256 amountBMin,
        uint256 reserveA,
        uint256 reserveB
    ) internal pure returns (uint256 amountA, uint256 amountB) {
        if (reserveA == 0 && reserveB == 0) {
            (amountA, amountB) = (amountADesired, amountBDesired);
        } else {
            uint256 amountBOptimal = (amountADesired * reserveB) / reserveA;
            if (amountBOptimal <= amountBDesired) {
                require(amountBOptimal >= amountBMin, "AetherRouter: INSUFFICIENT_B_AMOUNT");
                (amountA, amountB) = (amountADesired, amountBOptimal);
            } else {
                uint256 amountAOptimal = (amountBDesired * reserveA) / reserveB;
                require(amountAOptimal <= amountADesired);
                require(amountAOptimal >= amountAMin, "AetherRouter: INSUFFICIENT_A_AMOUNT");
                (amountA, amountB) = (amountAOptimal, amountBDesired);
            }
        }
    }

    function addLiquidity(
        address pool,
        uint256 amountADesired,
        uint256 amountBDesired,
        uint256 amountAMin,
        uint256 amountBMin,
        address to,
        uint256 deadline
    ) external nonReentrant checkDeadline(deadline) returns (uint256 amountA, uint256 amountB, uint256 liquidity) {
        require(pool != address(0), "InvalidPoolAddress");

        IAetherPool targetPool = IAetherPool(pool);
        (address token0, address token1) = targetPool.tokens();
        uint256 reserve0 = targetPool.reserve0();
        uint256 reserve1 = targetPool.reserve1();
        uint256 totalSupply = targetPool.totalSupply();

        // Calculate optimal amounts
        (amountA, amountB) = _calculateOptimalAmounts(
            amountADesired,
            amountBDesired,
            amountAMin,
            amountBMin,
            reserve0,
            reserve1
        );

        // Transfer tokens to router first (user must approve router)
        // Note: Tokens are token0 and token1 from pool perspective, but router inputs are A and B.
        // We assume router input A matches pool token0 and B matches token1 or vice versa.
        // But the input to addLiquidity doesn't specify which is which.
        // Standard Uniswap Router takes (tokenA, tokenB, amountADesired, amountBDesired...) and finds the pair.
        // Here we take (pool, amountADesired, amountBDesired).
        // This implies amountADesired corresponds to token0 and amountBDesired to token1?
        // Or we should assume the caller knows the order?
        // Let's assume amountA -> token0, amountB -> token1 for the given pool.

        // Transfer from user to router
        IERC20(token0).safeTransferFrom(msg.sender, address(this), amountA);
        IERC20(token1).safeTransferFrom(msg.sender, address(this), amountB);

        if (totalSupply == 0) {
            // Initial liquidity
            // Approve pool to spend tokens only for initial liquidity
            // Use forceApprove (or safeApprove with 0 reset) for USDT compatibility
            IERC20(token0).forceApprove(pool, amountA);
            IERC20(token1).forceApprove(pool, amountB);

            liquidity = targetPool.addInitialLiquidity(amountA, amountB);
        } else {
            // Subsequent liquidity
            // Calculate expected liquidity to mint
            liquidity = min((amountA * totalSupply) / reserve0, (amountB * totalSupply) / reserve1);

            // Cast to uint128 as mint expects uint128
            require(liquidity <= type(uint128).max, "Liquidity overflow");

            // Call mint
            // Note: mint in AetherPool returns required amounts, but expects tokens to be transferred?
            // Actually, MockPoolManager transfers tokens *after* calling mint.
            // But AetherPool.vy mint implementation:
            // "Assume the caller (PoolManager, msg.sender) has already transferred amount0/amount1 *to* the pool."
            // Wait, this is conflicting.

            // If I transfer tokens to the pool *before* calling mint, reserves in pool are NOT updated yet (balanceOf is updated).
            // But AetherPool.vy mint does `reserve0 = _reserve0 + amount0`.
            // It calculates amount0/amount1 from liquidity.

            // If I use `mint`, I provide liquidity amount. The pool tells me how much token0/1 corresponds to it.
            // I should transfer those amounts.

            // So:
            // 1. Calculate `liquidity` based on optimal amounts I have.
            // 2. Call `mint(to, liquidity)`. It returns `reqAmount0`, `reqAmount1`.
            // 3. `reqAmount0` should be close to `amountA`.
            // 4. Transfer `reqAmount0` and `reqAmount1` to pool.

            // Let's verify if `mint` expects tokens to be there or not.
            // AetherPool.vy:
            // `mint` does NOT call transferFrom. It assumes tokens are transferred.
            // BUT it does NOT check balances. It TRUSTS the caller.
            // So if I call `mint` then `transfer`, it should be fine as long as `mint` doesn't check balances.
            // `mint` emits event and updates reserves.

            (uint256 reqAmount0, uint256 reqAmount1) = targetPool.mint(to, uint128(liquidity));

            // Ensure we have enough tokens (we should, since we calculated liquidity based on optimal amounts)
            // There might be rounding errors.

            // If reqAmount > amountA, we might fail if we transferred exact amountA from user.
            // Usually we calculate liquidity = min(...). So reqAmount should be <= amountA.

            // Transfer required amounts to pool
            IERC20(token0).safeTransfer(pool, reqAmount0);
            IERC20(token1).safeTransfer(pool, reqAmount1);

            // Refund any excess to msg.sender
            if (amountA > reqAmount0) {
                IERC20(token0).safeTransfer(msg.sender, amountA - reqAmount0);
                amountA = reqAmount0;
            }
            if (amountB > reqAmount1) {
                IERC20(token1).safeTransfer(msg.sender, amountB - reqAmount1);
                amountB = reqAmount1;
            }
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
        require(pool != address(0), "InvalidPoolAddress");
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
        require(path.length == 3, "InvalidPath");
        address tokenIn = path[0];
        address pool = path[2];
        require(pool != address(0), "InvalidPoolAddress");

        amounts = new uint256[](2);
        amounts[0] = amountIn;

        _transferToPool(tokenIn, pool, amountIn);
        uint256 amountOut = _swap(pool, amountIn, tokenIn, to, amountOutMin);
        amounts[1] = amountOut;
        if (amountOut < amountOutMin) {
            revert Errors.InsufficientOutputAmount();
        }
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
        require(path.length == 3, "InvalidPath");
        address tokenInAddress = path[0];
        address pool = path[2];
        require(pool != address(0), "InvalidPoolAddress");

        // Permit the router to spend tokenIn on behalf of msg.sender
        _permitToken(IERC20Permit(tokenInAddress), msg.sender, address(this), amountIn, permitDeadline, v, r, s);

        amounts = new uint256[](2);
        amounts[0] = amountIn;

        // Router now has allowance, so it transfers from msg.sender to the pool.
        IERC20(tokenInAddress).safeTransferFrom(msg.sender, pool, amountIn);

        uint256 amountOut = _swap(pool, amountIn, tokenInAddress, to, amountOutMin);
        amounts[1] = amountOut;
        if (amountOut < amountOutMin) {
            revert Errors.InsufficientOutputAmount();
        }
    }

    modifier checkDeadline(uint256 deadline) override {
        if (deadline < block.timestamp) {
            revert Errors.DeadlineExpired();
        }
        _;
    }
}
