// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

import {IAetherPool} from "../../src/interfaces/IAetherPool.sol";

// Custom Errors for Mock
error ZeroAddress();
error IdenticalAddresses();
error InvalidTokenIn();
error InvalidRecipient();
error ZeroAmountIn();
error ZeroLiquidity();
error InsufficientLiquidity();
error NotInitialized();
error AlreadyInitialized();
error ZeroInitialLiquidity();

contract MockAetherPool is IAetherPool {
    address public token0;
    address public token1;
    uint24 public _fee;

    // Track minted liquidity for basic burn/mint logic
    uint256 public totalLiquidity;
    mapping(address => uint256) public liquidityOf;

    constructor(address _token0, address _token1, uint24 __fee) {
        initialize(_token0, _token1, __fee);
    }

    function initialize(address _token0, address _token1, uint24 __fee) public override {
        if (_token0 == address(0) || _token1 == address(0)) revert ZeroAddress();
        if (_token0 == _token1) revert IdenticalAddresses();
        token0 = _token0 < _token1 ? _token0 : _token1;
        token1 = _token0 < _token1 ? _token1 : _token0;
        _fee = __fee;
    }

    function tokens() external view override returns (address, address) {
        return (token0, token1);
    }

    function fee() external view override returns (uint24) {
        return _fee;
    }

    function swap(uint256 amountIn, address _tokenIn, address to) external override returns (uint256 amountOut) {
        if (!(_tokenIn == token0 || _tokenIn == token1)) revert InvalidTokenIn();
        if (to == address(0)) revert InvalidRecipient();
        if (amountIn == 0) revert ZeroAmountIn();

        // Simplified mock swap logic: 2% fee/slippage
        amountOut = (amountIn * 98) / 100;
        
        address _tokenOut = (_tokenIn == token0) ? token1 : token0;

        // Simulate transfer (not strictly necessary for this mock unless balances are tracked)
        // MockERC20(_tokenIn).transferFrom(msg.sender, address(this), amountIn); // Requires approvals
        // MockERC20(_tokenOut).transfer(to, amountOut);

        emit Swap(msg.sender, to, amountIn, amountOut, _tokenIn, _tokenOut, _fee);
        return amountOut;
    }

    function mint(address recipient, uint128 amount) external override returns (uint256 amount0, uint256 amount1) {
        if (recipient == address(0)) revert InvalidRecipient();
        if (amount == 0) revert ZeroLiquidity();

        // Simplified mock mint: assume 1:1 token contribution for LP amount for simplicity
        amount0 = uint256(amount); // Placeholder value
        amount1 = uint256(amount); // Placeholder value

        totalLiquidity += amount;
        liquidityOf[recipient] += amount;

        emit Mint(msg.sender, recipient, amount0, amount1, amount);
        return (amount0, amount1);
    }

    function burn(address to, uint256 liquidity) external override returns (uint256 amount0, uint256 amount1) {
        if (to == address(0)) revert InvalidRecipient();
        if (liquidity == 0) revert ZeroLiquidity();
        if (liquidityOf[msg.sender] < liquidity) revert InsufficientLiquidity(); // Basic check

        // Simplified mock burn: return 1:1 tokens for LP amount
        amount0 = liquidity; // Placeholder value
        amount1 = liquidity; // Placeholder value

        totalLiquidity -= liquidity;
        liquidityOf[msg.sender] -= liquidity;

        emit Burn(msg.sender, to, amount0, amount1, liquidity);
        return (amount0, amount1);
    }

    function addInitialLiquidity(uint256 amount0Desired, uint256 amount1Desired) external override returns (uint256 liquidity) {
        if (!(token0 != address(0) && token1 != address(0))) revert NotInitialized();
        if (totalLiquidity != 0) revert AlreadyInitialized(); // Can only add initial liquidity once
        if (!(amount0Desired > 0 && amount1Desired > 0)) revert ZeroInitialLiquidity();

        // Simplified: liquidity is sum of amounts (not price-based)
        liquidity = amount0Desired + amount1Desired; 
        totalLiquidity = liquidity;
        liquidityOf[msg.sender] = liquidity; // Assign to caller

        emit Mint(msg.sender, msg.sender, amount0Desired, amount1Desired, liquidity);
        return liquidity;
    }
}
