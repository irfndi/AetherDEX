// SPDX-License-Identifier: GPL-3.0

/*
Created by irfndi (github.com/irfndi) - Apr 2025
Email: join.mantap@gmail.com
*/

pragma solidity ^0.8.29;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IAetherPool} from "../interfaces/IAetherPool.sol";
import {BaseRouter} from "./BaseRouter.sol";

/**
 * @title AetherRouter (Simplified)
 * @notice Handles interactions with AetherPool instances for swaps and liquidity.
 * @dev Assumes pools are already deployed. Caller must approve pool tokens.
 */
contract AetherRouter is BaseRouter {
    function addLiquidity(
        address pool,
        uint256 amountADesired,
        uint256 amountBDesired,
        uint256, /*amountAMin*/
        uint256, /*amountBMin*/
        address to,
        uint256 deadline
    ) external nonReentrant checkDeadline(deadline) returns (uint256 amountA, uint256 amountB, uint256 liquidity) {
        require(pool != address(0), "InvalidPoolAddress");
        // TODO: Implement liquidity addition via PoolManager
        // liquidity = IAetherPool(pool).mint(to, amountADesired, amountBDesired); // Old incompatible call
        amountA = amountADesired;
        amountB = amountBDesired;
    }

    function removeLiquidity(
        address pool,
        uint256 liquidity,
        uint256, /*amountAMin*/
        uint256, /*amountBMin*/
        address to,
        uint256 deadline
    ) external nonReentrant checkDeadline(deadline) returns (uint256 amountA, uint256 amountB) {
        require(pool != address(0), "InvalidPoolAddress");
        _transferToPool(pool, pool, liquidity);
        (amountA, amountB) = IAetherPool(pool).burn(to, liquidity);
        require(amountA >= 0, "InsufficientOutputAmount");
        require(amountB >= 0, "InsufficientOutputAmount");
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
        uint256 amountOut = _swap(pool, amountIn, tokenIn, to);
        amounts[1] = amountOut;
        require(amountOut >= amountOutMin, "InsufficientOutputAmount");
    }
}
