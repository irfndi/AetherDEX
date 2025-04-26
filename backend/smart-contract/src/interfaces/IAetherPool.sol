// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.29;

interface IAetherPool {
    function initialize(address _token0, address _token1, uint24 _fee) external; // Added underscores to params

    function mint(address recipient, uint256 amount0Desired, uint256 amount1Desired)
        external
        returns (uint256 shares);

    function burn(address recipient, uint256 liquidity) external returns (uint256 amount0, uint256 amount1);

    function token0() external view returns (address);
    function token1() external view returns (address);
    function fee() external view returns (uint24);

    function swap(uint256 amountIn, address tokenIn, address recipient /*, address sender */) // Removed sender parameter
        external
        returns (uint256 amountOut);
}
