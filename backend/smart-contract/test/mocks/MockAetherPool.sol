// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

import {IAetherPool} from "../../src/interfaces/IAetherPool.sol";
import {MockERC20} from "./MockERC20.sol"; // Assuming SafeERC20/transfer simulation might be needed later

contract MockAetherPool is IAetherPool {
    address public token0;
    address public token1;
    uint24 public _fee;

    // Track minted liquidity for basic burn/mint logic
    uint256 public totalLiquidity;
    mapping(address => uint256) public liquidityOf;

    // Track reserves
    uint256 public _reserve0;
    uint256 public _reserve1;

    constructor(address _token0, address _token1, uint24 __fee) {
        initialize(_token0, _token1, __fee);
    }

    function initialize(address _token0, address _token1, uint24 __fee) public override {
        require(_token0 != address(0) && _token1 != address(0), "ZERO_ADDRESS");
        require(_token0 != _token1, "IDENTICAL_ADDRESSES");
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
        require(_tokenIn == token0 || _tokenIn == token1, "INVALID_TOKEN_IN");
        require(to != address(0), "INVALID_RECIPIENT");
        require(amountIn > 0, "ZERO_AMOUNT_IN");

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
        require(recipient != address(0), "INVALID_RECIPIENT");
        require(amount > 0, "ZERO_LIQUIDITY");

        // Simplified mock mint: assume reserves are used to calculate amounts
        // amount0 = (amount * reserve0) / totalLiquidity
        if (totalLiquidity > 0) {
            amount0 = (uint256(amount) * _reserve0) / totalLiquidity;
            amount1 = (uint256(amount) * _reserve1) / totalLiquidity;
        } else {
            // Fallback for initial mint via mint() if happens
             amount0 = uint256(amount);
             amount1 = uint256(amount);
        }

        totalLiquidity += amount;
        liquidityOf[recipient] += amount;

        _reserve0 += amount0;
        _reserve1 += amount1;

        // Mock transfer from caller (Router) to pool: REMOVED
        // AetherPool.vy mint() assumes tokens are transferred by caller (Router), it doesn't pull them.
        // We simulate the reserve update here, but let the Router handle the transfer.

        emit Mint(msg.sender, recipient, amount0, amount1, amount);
        return (amount0, amount1);
    }

    function burn(address to, uint256 liquidity) external override returns (uint256 amount0, uint256 amount1) {
        require(to != address(0), "INVALID_RECIPIENT");
        require(liquidity > 0, "ZERO_LIQUIDITY");
        require(liquidityOf[msg.sender] >= liquidity, "INSUFFICIENT_LIQUIDITY"); // Basic check

        // Simplified mock burn
        if (totalLiquidity > 0) {
            amount0 = (liquidity * _reserve0) / totalLiquidity;
            amount1 = (liquidity * _reserve1) / totalLiquidity;
        }

        totalLiquidity -= liquidity;
        liquidityOf[msg.sender] -= liquidity;

        _reserve0 -= amount0;
        _reserve1 -= amount1;

        emit Burn(msg.sender, to, amount0, amount1, liquidity);
        return (amount0, amount1);
    }

    function addInitialLiquidity(uint256 amount0Desired, uint256 amount1Desired) external override returns (uint256 liquidity) {
        require(token0 != address(0) && token1 != address(0), "NOT_INITIALIZED");
        require(totalLiquidity == 0, "ALREADY_INITIALIZED"); // Can only add initial liquidity once
        require(amount0Desired > 0 && amount1Desired > 0, "ZERO_INITIAL_LIQUIDITY");

        // Simplified: liquidity is sum of amounts (not price-based)
        liquidity = amount0Desired + amount1Desired; 
        totalLiquidity = liquidity;
        liquidityOf[msg.sender] = liquidity; // Assign to caller

        // Update reserves
        _reserve0 += amount0Desired;
        _reserve1 += amount1Desired;

        // Mock token transfer behavior: pull tokens from sender
        MockERC20(token0).transferFrom(msg.sender, address(this), amount0Desired);
        MockERC20(token1).transferFrom(msg.sender, address(this), amount1Desired);

        emit Mint(msg.sender, msg.sender, amount0Desired, amount1Desired, liquidity);
        return liquidity;
    }

    function reserve0() external view returns (uint256) {
        return _reserve0;
    }

    function reserve1() external view returns (uint256) {
        return _reserve1;
    }

    function totalSupply() external view returns (uint256) {
        return totalLiquidity;
    }
}
