// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.29;

interface IAetherPool {
    function initialize(address token0, address token1, uint24 fee) external; // Removed unused poolManager parameter

    function mint(address recipient, uint256 amount0Desired, uint256 amount1Desired)
        external
        returns (uint256 shares);

    function burn(address recipient, uint256 liquidity) external returns (uint256 amount0, uint256 amount1);

    function token0() external view returns (address);
    function token1() external view returns (address);
    function fee() external view returns (uint24);

    function swap(uint256 amountIn, address tokenIn, address recipient, address sender)
        external
        returns (uint256 amountOut);
}
