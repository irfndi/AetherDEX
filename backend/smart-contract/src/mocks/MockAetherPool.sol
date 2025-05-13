// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.29;

import {IAetherPool} from "../interfaces/IAetherPool.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {MockToken} from "./MockToken.sol"; // <-- Path relative to src

/**
 * @title MockAetherPool
 * @notice Minimal mock implementation of IAetherPool for testing purposes.
 */
contract MockAetherPool is IAetherPool {
    address public immutable token0;
    address public immutable token1;
    address public immutable vault;

    constructor(address _token0, address _token1, address _vault) {
        token0 = _token0;
        token1 = _token1;
        vault = _vault;
    }

    // --- Mock IAetherPool Functions ---

    function tokens() external view returns (address _token0, address _token1) {
        return (token0, token1);
    }

    function initialize(address _token0, address _token1, uint24 feeRate) external {
        // Mock initialize - does nothing for this basic mock
    }

    function swap(uint256 amountIn, address tokenIn, address to) external returns (uint256 amountOut) {
        // Mock swap - determine output token, mint to pool, transfer to recipient
        address tokenOut = (tokenIn == token0) ? token1 : token0;
        amountOut = amountIn; // Simulate 1:1 swap for simplicity

        // Mint the output amount to the pool contract itself
        MockToken(tokenOut).mint(address(this), amountOut);

        // Transfer the output amount from the pool to the recipient
        require(MockToken(tokenOut).transfer(to, amountOut), "MockPool Transfer Failed");

        return amountOut;
    }

    function mint(address /*recipient*/, uint128 /*amount*/) external pure returns (uint256 amount0, uint256 amount1) {
        // Mock mint - returns 0
        return (0, 0);
    }

    function burn(address /*to*/, uint256 /*liquidity*/) external pure returns (uint256 amount0, uint256 amount1) {
        // Mock burn - returns 0
        return (0, 0);
    }

    // --- Missing Functions from Interface ---

    // Placeholder for addInitialLiquidity
    function addInitialLiquidity(uint256 /*amount0Desired*/, uint256 /*amount1Desired*/) external pure returns (uint256 liquidity) {
        return 0;
    }

    // Placeholder for fee
    function fee() external pure returns (uint24 feeRate) {
        return 0; // Default mock fee
    }

    /**
     * @dev Mock function to calculate rewards (simplified)
     */
    function calculateReward(uint256 /* amount */, uint256 /* duration */) external pure returns (uint256) {
        // Simple mock: return a fixed reward or based on some basic logic
        return 1 ether; // Example fixed reward
    }
}
