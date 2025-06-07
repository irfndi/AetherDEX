// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.29;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IAetherPool} from "../interfaces/IAetherPool.sol";
import {Errors} from "../libraries/Errors.sol";

contract SimpleSwapRouter is ReentrancyGuard {
    using SafeERC20 for IERC20;

    modifier checkDeadline(uint256 deadline) {
        if (block.timestamp > deadline) revert Errors.DeadlineExpired();
        _;
    }

    function _swap(address pool, uint256 amountIn, address tokenIn, address to, uint256 minAmountOut)
        private
        returns (uint256 amountOut)
    {
        amountOut = IAetherPool(pool).swap(amountIn, tokenIn, to);
        if (amountOut < minAmountOut) revert Errors.InsufficientOutputAmount();
    }

    function swapExactTokensForTokens(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external nonReentrant checkDeadline(deadline) returns (uint256[] memory amounts) {
        require(path.length == 3, Errors.InvalidPath());
        require(path[2] != address(0), Errors.ZeroAddress());

        amounts = new uint256[](2);
        amounts[0] = amountIn;

        IERC20(path[0]).safeTransferFrom(msg.sender, path[2], amountIn);

        uint256 amountOut = _swap(path[2], amountIn, path[0], to, amountOutMin);
        amounts[1] = amountOut;
    }
}
