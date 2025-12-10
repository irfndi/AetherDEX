// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

import {IAetherPool} from "../../src/interfaces/IAetherPool.sol";
import {MockERC20} from "./MockERC20.sol"; // Assuming SafeERC20/transfer simulation might be needed later

contract MockAetherPool is IAetherPool {
    address public token0;
    address public token1;
    uint24 public _fee;
    bool private _initialized;

    // Track minted liquidity for basic burn/mint logic
    uint256 public totalLiquidity;
    mapping(address => uint256) public liquidityOf;

    constructor(address _token0, address _token1, uint24 __fee) {
        initialize(_token0, _token1, __fee);
    }

    function initialize(address _token0, address _token1, uint24 __fee) public override {
        require(!_initialized, "ALREADY_INITIALIZED");
        require(_token0 != address(0) && _token1 != address(0), "ZERO_ADDRESS");
        require(_token0 != _token1, "IDENTICAL_ADDRESSES");
        token0 = _token0 < _token1 ? _token0 : _token1;
        token1 = _token0 < _token1 ? _token1 : _token0;
        _fee = __fee;
        _initialized = true;
    }

    function tokens() external view override returns (address, address) {
        return (token0, token1);
    }

    function fee() external view override returns (uint24) {
        return _fee;
    }

    function reserve0() external pure override returns (uint256) {
        return 1000 * 1e18; // Dummy reserve
    }

    function reserve1() external pure override returns (uint256) {
        return 1000 * 1e18; // Dummy reserve
    }

    function totalSupply() external view override returns (uint256) {
        return totalLiquidity;
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

        // Simplified mock mint: assume 1:1 token contribution for LP amount for simplicity
        amount0 = uint256(amount); // Placeholder value
        amount1 = uint256(amount); // Placeholder value

        totalLiquidity += amount;
        liquidityOf[recipient] += amount;

        emit Mint(msg.sender, recipient, amount0, amount1, amount);
        return (amount0, amount1);
    }

    function burn(address to, uint256 liquidity) external override returns (uint256 amount0, uint256 amount1) {
        require(to != address(0), "INVALID_RECIPIENT");
        require(liquidity > 0, "ZERO_LIQUIDITY");
        require(liquidityOf[to] >= liquidity, "INSUFFICIENT_LIQUIDITY"); // Basic check for recipient

        // Simplified mock burn: return 1:1 tokens for LP amount
        amount0 = liquidity; // Placeholder value
        amount1 = liquidity; // Placeholder value

        totalLiquidity -= liquidity;
        liquidityOf[to] -= liquidity;

        emit Burn(msg.sender, to, amount0, amount1, liquidity);
        return (amount0, amount1);
    }

    function addInitialLiquidity(uint256 amount0Desired, uint256 amount1Desired)
        external
        override
        returns (uint256 liquidity)
    {
        require(token0 != address(0) && token1 != address(0), "NOT_INITIALIZED");
        require(totalLiquidity == 0, "ALREADY_INITIALIZED"); // Can only add initial liquidity once
        require(amount0Desired > 0 && amount1Desired > 0, "ZERO_INITIAL_LIQUIDITY");

        // Simplified: liquidity is sum of amounts (not price-based)
        liquidity = amount0Desired + amount1Desired;
        totalLiquidity = liquidity;
        liquidityOf[msg.sender] = liquidity; // Assign to caller

        emit Mint(msg.sender, msg.sender, amount0Desired, amount1Desired, liquidity);
        return liquidity;
    }

    function addLiquidityNonInitial(
        address recipient,
        uint256 amount0Desired,
        uint256 amount1Desired,
        bytes calldata /* data */
    )
        external
        override
        returns (uint256 amount0Actual, uint256 amount1Actual, uint256 liquidityMinted)
    {
        require(token0 != address(0) && token1 != address(0), "NOT_INITIALIZED");
        require(totalLiquidity > 0, "USE_ADD_INITIAL_LIQUIDITY");
        require(amount0Desired > 0 && amount1Desired > 0, "ZERO_LIQUIDITY");
        require(recipient != address(0), "INVALID_RECIPIENT");

        // Simplified: use desired amounts as actual amounts and sum for liquidity
        amount0Actual = amount0Desired;
        amount1Actual = amount1Desired;
        liquidityMinted = amount0Desired + amount1Desired;

        totalLiquidity += liquidityMinted;
        liquidityOf[recipient] += liquidityMinted;

        emit Mint(msg.sender, recipient, amount0Actual, amount1Actual, liquidityMinted);
        return (amount0Actual, amount1Actual, liquidityMinted);
    }
}
