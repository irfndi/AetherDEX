// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.29;

import "forge-std/console2.sol";
import "./libraries/TransferHelper.sol";
import "./libraries/FixedPoint.sol";
import "./interfaces/IAetherPool.sol";

/**
 * @title AetherPool
 * @author AetherDEX
 * @notice Implements a basic liquidity pool for token swaps and liquidity provision.
 */
contract AetherPool is IAetherPool {
    using FixedPoint for uint256;

    event Swap(address indexed sender, address tokenIn, address tokenOut, uint256 amountIn, uint256 amountOut);
    event LiquidityAdded(address indexed provider, uint256 amount0, uint256 amount1, uint256 liquidity);
    event LiquidityRemoved(address indexed provider, uint256 amount0, uint256 amount1, uint256 liquidity);

    address public immutable factory;
    address public token0;
    address public token1;
    // address public poolManager; // Removed unused variable
    uint24 public fee; // Fee stored as state variable

    uint256 public reserve0;
    uint256 public reserve1;
    // uint256 public constant FEE = 3000; // Removed hardcoded fee
    uint256 public totalSupply;

    bool public initialized; // Made public

    constructor(address _factory) {
        require(_factory != address(0), "ZERO_FACTORY_ADDRESS");
        factory = _factory;
    }

    function initialize(
        address _token0,
        address _token1,
        uint24 fee_ // Use the fee parameter
        // address _poolManager // Removed unused parameter
    ) external override {
        require(!initialized, "ALREADY_INITIALIZED");
        require(_token0 != address(0) && _token1 != address(0), "ZERO_TOKEN_ADDRESS");
        require(_token0 != _token1, "IDENTICAL_TOKENS");
        // require(_poolManager != address(0), "ZERO_POOL_MANAGER"); // Removed check for unused parameter
        // [TODO]: Add check for valid fee range if applicable (e.g., fee_ < 10000)

        // Ensure consistent token ordering
        if (_token0 < _token1) {
            token0 = _token0;
            token1 = _token1;
        } else {
            token0 = _token1;
            token1 = _token0;
        }

        // poolManager = _poolManager; // Removed assignment for unused variable
        fee = fee_; // Store the provided fee
        initialized = true;
    }

    function getReserves() public view returns (uint256 reserve0_, uint256 reserve1_) {
        return (reserve0, reserve1);
    }

    // The public state variable 'fee' automatically creates this getter.
    // function fee() external view returns (uint24) {
    //     return fee;
    // }

    function mint(address to, uint256 amount0, uint256 amount1) external override returns (uint256 liquidity) {
        require(initialized, "NOT_INITIALIZED");
        require(to != address(0), "ZERO_ADDRESS");
        require(amount0 > 0 && amount1 > 0, "INSUFFICIENT_INPUT_AMOUNT");

        (uint256 _reserve0, uint256 _reserve1) = getReserves();

        if (totalSupply == 0) {
            liquidity = _sqrt(amount0 * amount1);
        } else {
            liquidity = _min(
                (amount0 * totalSupply) / _reserve0,
                (amount1 * totalSupply) / _reserve1
            );
        }

        require(liquidity > 0, "INSUFFICIENT_LIQUIDITY_MINTED");

        TransferHelper.safeTransferFrom(token0, msg.sender, address(this), amount0);
        TransferHelper.safeTransferFrom(token1, msg.sender, address(this), amount1);

        reserve0 = _reserve0 + amount0;
        reserve1 = _reserve1 + amount1;
        totalSupply += liquidity;

        emit LiquidityAdded(to, amount0, amount1, liquidity);
    }

    function burn(address to, uint256 liquidity) external override returns (uint256 amount0, uint256 amount1) {
        require(initialized, "NOT_INITIALIZED");
        require(to != address(0), "ZERO_ADDRESS");
        require(liquidity > 0, "INSUFFICIENT_LIQUIDITY_BURNED");

        (uint256 _reserve0, uint256 _reserve1) = getReserves();

        amount0 = (liquidity * _reserve0) / totalSupply;
        amount1 = (liquidity * _reserve1) / totalSupply;

        require(amount0 > 0 && amount1 > 0, "INSUFFICIENT_LIQUIDITY_BURNED");

        totalSupply -= liquidity;
        reserve0 = _reserve0 - amount0;
        reserve1 = _reserve1 - amount1;

        TransferHelper.safeTransfer(token0, to, amount0);
        TransferHelper.safeTransfer(token1, to, amount1);

        emit LiquidityRemoved(to, amount0, amount1, liquidity);
    }

    function swap(
        uint256 amountIn,
        address tokenIn,
        address to,
        address sender
    ) external override returns (uint256 amountOut) {
        // --- Checks ---
        require(initialized, "NOT_INITIALIZED");
        require(tokenIn == token0 || tokenIn == token1, "INVALID_TOKEN_IN");
        require(to != address(0), "ZERO_ADDRESS");
        require(amountIn > 0, "INSUFFICIENT_INPUT_AMOUNT");

        bool isToken0In = tokenIn == token0;
        // Capture current reserves locally to prevent manipulation during external calls
        (uint256 _reserve0, uint256 _reserve1) = (reserve0, reserve1); 
        (uint256 reserveIn, uint256 reserveOut) = isToken0In ? 
            (_reserve0, _reserve1) : 
            (_reserve1, _reserve0);

        // Calculate output amount based on current reserves and fee
        uint256 currentFee = fee; // Use the state variable fee
        uint256 amountInWithFee = (amountIn * (10000 - currentFee)) / 10000;
        amountOut = (amountInWithFee * reserveOut) / (reserveIn + amountInWithFee);
        
        require(amountOut > 0, "INSUFFICIENT_OUTPUT_AMOUNT");
        // [FIXME]: Add check require(amountOut < reserveOut) to prevent draining the pool? Needs careful consideration.

        // --- Effects (Update state *before* external calls) ---
        if (isToken0In) {
            reserve0 = reserveIn + amountIn;
            reserve1 = reserveOut - amountOut;
        } else {
            reserve1 = reserveIn + amountIn;
            reserve0 = reserveOut - amountOut;
        }

        // --- Interactions (External calls last) ---
        // Transfer input tokens from the sender
        TransferHelper.safeTransferFrom(tokenIn, sender, address(this), amountIn); 

        // Transfer output tokens to the recipient
        address tokenOut = isToken0In ? token1 : token0;
        TransferHelper.safeTransfer(tokenOut, to, amountOut);
    }

    // Internal functions
    function _sqrt(uint256 y) internal pure returns (uint256 z) {
        if (y > 3) {
            z = y;
            uint256 x = y / 2 + 1;
            while (x < z) {
                z = x;
                x = (y / x + x) / 2;
            }
        } else if (y != 0) {
            z = 1;
        }
    }

    function _min(uint256 x, uint256 y) internal pure returns (uint256) {
        return x < y ? x : y;
    }
}
