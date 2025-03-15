// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.29;

import "./AetherPool.sol";
import "./AetherFactory.sol"; // Import AetherFactory to interact with it
import "./libraries/TransferHelper.sol";

/**
 * @title AetherRouter
 * @author AetherDEX
 * @notice Router contract for performing swaps on AetherDEX pools.
 */
contract AetherRouter {
    /**
     * @notice Address of the AetherFactory contract.
     */
    address public immutable factoryAddress;

    /**
     * @notice Constructor to set the factory address.
     * @param _factory Address of the AetherFactory contract.
     */
    constructor(address _factory) {
        factoryAddress = _factory;
    }

    /**
     * @notice Swaps exact ETH for tokens.
     * @param amountOutMin Minimum amount of output tokens to receive.交易 will revert if less is received.
     * @param path Array of token addresses representing the swap path (e.g., [WETH, DAI]). Must be length of 2.
     * @param to Address to receive the output tokens.
     * @dev Executes a swap of ETH for tokens through an AetherPool contract.
     * @dev Reverts if invalid path, pool not found, or slippage tolerance is not met.
     */
    function swapExactETHForTokens(uint256 amountOutMin, address[] calldata path, address to) external payable {
        require(path.length == 2, "INVALID_PATH");
        address tokenIn = path[0];
        address tokenOut = path[1];
        address poolAddress = AetherFactory(factoryAddress).getPool(tokenIn, tokenOut); // Use factory to get pool
        require(poolAddress != address(0), "POOL_NOT_FOUND");
        AetherPool pool = AetherPool(poolAddress);
        (uint256 reserveIn, uint256 reserveOut) = pool.getReserves();
        uint256 amountIn = msg.value;
        uint256 amountOut = (amountIn * reserveOut) / (reserveIn + amountIn);
        require(amountOut >= amountOutMin, "SLIPPAGE");

        (bool success,) = address(pool).call{value: amountIn}("");
        require(success, "ETH_TRANSFER_FAILED");
        pool.swap(amountOut, tokenOut, to, msg.sender); // Updated swap call with msg.sender
    }

    /**
     * @notice Receive function to accept ETH deposits for swapExactETHForTokens.
     */
    receive() external payable {}

    /**
     * @notice Swaps exact tokens for tokens.
     * @param amountIn Amount of input tokens to swap.
     * @param amountOutMin Minimum amount of output tokens to receive.交易 will revert if less is received.
     * @param path Array of token addresses representing the swap path (e.g., [DAI, USDC]). Must be length of 2.
     * @param to Address to receive the output tokens.
     * @dev Executes a swap of tokens for tokens through an AetherPool contract.
     * @dev Reverts if invalid path, pool not found, or slippage tolerance is not met.
     */
    function swapExactTokensForTokens(uint256 amountIn, uint256 amountOutMin, address[] calldata path, address to)
        external
    {
        require(path.length == 2, "INVALID_PATH");
        address tokenIn = path[0];
        address tokenOut = path[1];
        address poolAddress = AetherFactory(factoryAddress).getPool(tokenIn, tokenOut); // Use factory to get pool
        require(poolAddress != address(0), "POOL_NOT_FOUND");
        AetherPool pool = AetherPool(poolAddress);

        TransferHelper.safeTransferFrom(tokenIn, msg.sender, address(pool), amountIn);

        (uint256 reserveIn, uint256 reserveOut) = pool.getReserves();
        uint256 amountOut = (amountIn * reserveOut) / (reserveIn + amountIn);
        require(amountOut >= amountOutMin, "SLIPPAGE");

        pool.swap(amountOut, tokenOut, to, msg.sender); // Updated swap call with msg.sender
    }
}
