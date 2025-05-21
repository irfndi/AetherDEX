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

    struct PermitDetails {
        uint256 deadline; // Deadline for the permit signature
        uint8 v;
        bytes32 r;
        bytes32 s;
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
        uint256 forceReadDeadline = deadline; // Read 'deadline'
        forceReadDeadline = forceReadDeadline; // "Use" the local variable to silence linter
        // Parameter 'deadline' is used by the checkDeadline modifier
        // TODO: Implement liquidity addition via PoolManager and IAetherPool.mint
        // For now, we'll simulate the assignments and checks for parameters.
        // IAetherPool actualMintCall = IAetherPool(pool);
        // (amountA, amountB, liquidity) = actualMintCall.mint(to, amountADesired, amountBDesired); // Example, if mint returns all three

        // Placeholder logic until PoolManager/mint is integrated:
        amountA = amountADesired; // In a real scenario, amountA would come from the mint call
        amountB = amountBDesired; // In a real scenario, amountB would come from the mint call
        liquidity = 0; // Placeholder, should be from mint call

        if (amountA < amountAMin) {
            revert Errors.InsufficientAAmount();
        }
        if (amountB < amountBMin) {
            revert Errors.InsufficientBAmount();
        }
        // require(liquidity >= liquidityMin, "AetherRouter: INSUFFICIENT_LIQUIDITY_MINTED"); // If liquidityMin were a param
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
        PermitDetails calldata permitDetails
    ) external nonReentrant checkDeadline(deadline) returns (uint256[] memory amounts) {
        require(path.length == 3, "InvalidPath");
        address tokenInAddress = path[0];
        address pool = path[2];
        require(pool != address(0), "InvalidPoolAddress");

        // Permit the router to spend tokenIn on behalf of msg.sender
        _permitToken(
            IERC20Permit(tokenInAddress),
            msg.sender,
            address(this),
            amountIn,
            permitDetails.deadline,
            permitDetails.v,
            permitDetails.r,
            permitDetails.s
        );

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
