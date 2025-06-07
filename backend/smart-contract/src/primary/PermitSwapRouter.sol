// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.29;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IAetherPool} from "../interfaces/IAetherPool.sol";
import {Errors} from "../libraries/Errors.sol";
import {IERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Permit.sol";

contract PermitSwapRouter is ReentrancyGuard {
    using SafeERC20 for IERC20;

    struct SwapParamsWithPermit {
        uint256 amountIn;
        uint256 amountOutMin;
        address[] path;
        address to;
        uint256 deadline;
        uint256 permitDeadline;
        uint8 v;
        bytes32 r;
        bytes32 s;
    }

    modifier checkDeadline(uint256 deadline) {
        if (block.timestamp > deadline) revert Errors.DeadlineExpired();
        _;
    }

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
        if (IERC20(address(token)).allowance(owner, spender) < amount) {
            token.permit(owner, spender, amount, deadline, v, r, s);
        }
    }

    function _swap(address pool, uint256 amountIn, address tokenIn, address to, uint256 minAmountOut)
        private
        returns (uint256 amountOut)
    {
        amountOut = IAetherPool(pool).swap(amountIn, tokenIn, to);
        if (amountOut < minAmountOut) revert Errors.InsufficientOutputAmount();
    }

    function swapExactTokensForTokensWithPermit(
        SwapParamsWithPermit calldata params
    ) external nonReentrant checkDeadline(params.deadline) returns (uint256[] memory amounts) {
        require(params.path.length == 3, Errors.InvalidPath());
        require(params.path[2] != address(0), Errors.ZeroAddress());

        _permitToken(IERC20Permit(params.path[0]), msg.sender, address(this), params.amountIn, params.permitDeadline, params.v, params.r, params.s);

        amounts = new uint256[](2);
        amounts[0] = params.amountIn;

        IERC20(params.path[0]).safeTransferFrom(msg.sender, params.path[2], params.amountIn);

        uint256 amountOut = _swap(params.path[2], params.amountIn, params.path[0], params.to, params.amountOutMin);
        amounts[1] = amountOut;
    }
}
