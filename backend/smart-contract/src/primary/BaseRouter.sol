// SPDX-License-Identifier: GPL-3.0

/*
Created by irfndi (github.com/irfndi) - Apr 2025
Email: join.mantap@gmail.com
*/

pragma solidity ^0.8.29;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IAetherPool} from "../interfaces/IAetherPool.sol";
import {IPoolManager} from "../interfaces/IPoolManager.sol";
import {PoolKey} from "../types/PoolKey.sol";

abstract contract BaseRouter is ReentrancyGuard {
    using SafeERC20 for IERC20;

    modifier checkDeadline(uint256 deadline) {
        require(block.timestamp <= deadline, "DeadlineExpired");
        _;
    }

    function _transferToPool(address token, address pool, uint256 amount) internal {
        require(pool != address(0), "InvalidPoolAddress");
        IERC20(token).safeTransferFrom(msg.sender, pool, amount);
    }

    function _swap(address pool, uint256 amountIn, address tokenIn, address to, uint256 minAmountOut)
        internal
        returns (uint256 amountOut)
    {
        amountOut = IAetherPool(pool).swap(amountIn, tokenIn, to);
        require(amountOut >= minAmountOut, "SlippageExceeded");
    }
}
