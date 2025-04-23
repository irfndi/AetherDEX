// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.29;

import "forge-std/console2.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol"; // Import ReentrancyGuard
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "./libraries/TransferHelper.sol";
import "./libraries/FixedPoint.sol";
import "./interfaces/IAetherPool.sol";

/**
 * @title AetherPool
 * @author AetherDEX
 * @notice Implements a basic liquidity pool for token swaps and liquidity provision.
 */
contract AetherPool is IAetherPool, ReentrancyGuard { // Inherit ReentrancyGuard
    using FixedPoint for uint256;

    event Swap(address indexed sender, address tokenIn, address tokenOut, uint256 amountIn, uint256 amountOut);
    event LiquidityAdded(address indexed provider, uint256 amount0, uint256 amount1, uint256 liquidity);
    event LiquidityRemoved(address indexed provider, uint256 amount0, uint256 amount1, uint256 liquidity);

    address public immutable factory;
    address public token0;
    address public token1;
    uint24 public fee; 

    uint256 public reserve0;
    uint256 public reserve1;
    uint256 public totalSupply;

    bool public initialized; 

    constructor(address _factory) {
        require(_factory != address(0), "ZERO_FACTORY_ADDRESS");
        factory = _factory;
    }

    function initialize(
        address initialToken0, 
        address initialToken1,
        uint24 initialFee 
    ) external override {
        require(!initialized, "ALREADY_INITIALIZED");
        require(initialToken0 != address(0) && initialToken1 != address(0), "ZERO_TOKEN_ADDRESS");
        require(initialToken0 != initialToken1, "IDENTICAL_TOKENS");
        require(initialFee <= 10000, "INVALID_FEE"); // Use fee

        if (initialToken0 < initialToken1) {
            token0 = initialToken0;
            token1 = initialToken1;
        } else {
            token0 = initialToken1;
            token1 = initialToken0;
        }

        fee = initialFee; // Use fee
        initialized = true;
    }

    function getReserves() public view returns (uint256 reserve0_, uint256 reserve1_) {
        return (reserve0, reserve1);
    }

    function mint(address to, uint256 amount0, uint256 amount1) external override nonReentrant returns (uint256 liquidity) { // Added nonReentrant modifier
        // --- Checks ---
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

        // --- Effects (Update state *before* external transfers) ---
        reserve0 = _reserve0 + amount0;
        reserve1 = _reserve1 + amount1;
        totalSupply += liquidity;
        emit LiquidityAdded(to, amount0, amount1, liquidity); // Emit event before external calls

        // --- Interactions (Transfer tokens after state updates) ---
        TransferHelper.safeTransferFrom(token0, msg.sender, address(this), amount0);
        TransferHelper.safeTransferFrom(token1, msg.sender, address(this), amount1);

        // return liquidity; // Implicitly returned
    }

    function burn(address to, uint256 liquidity) external override nonReentrant returns (uint256 amount0, uint256 amount1) { // Added nonReentrant modifier
        // --- Checks ---
        require(initialized, "NOT_INITIALIZED");
        require(to != address(0), "ZERO_ADDRESS");
        require(liquidity > 0, "INSUFFICIENT_LIQUIDITY_BURNED");

        (uint256 _reserve0, uint256 _reserve1) = getReserves();

        amount0 = (liquidity * _reserve0) / totalSupply;
        amount1 = (liquidity * _reserve1) / totalSupply;

        require(amount0 > 0 && amount1 > 0, "INSUFFICIENT_LIQUIDITY_BURNED");

        // --- Effects (Update state *before* external transfers) ---
        totalSupply -= liquidity;
        reserve0 = _reserve0 - amount0;
        reserve1 = _reserve1 - amount1;

        // --- Interactions (Emit event *before* external transfers) ---
        emit LiquidityRemoved(to, amount0, amount1, liquidity); // Effect (Event)
        TransferHelper.safeTransfer(token0, to, amount0); // Interaction
        TransferHelper.safeTransfer(token1, to, amount1);

        // return amount0, amount1; // Implicitly returned
    }

    function swap(
        uint256 amountIn,
        address tokenIn,
        address to
        // address sender // Removed sender parameter
    ) external override returns (uint256 amountOut) {
        require(initialized, "NOT_INITIALIZED");
        require(tokenIn == token0 || tokenIn == token1, "INVALID_TOKEN_IN");
        require(to != address(0), "ZERO_ADDRESS");
        require(amountIn > 0, "INSUFFICIENT_INPUT_AMOUNT");

        bool isToken0In = tokenIn == token0;
        (uint256 _reserve0, uint256 _reserve1) = (reserve0, reserve1); // Read from state
        console2.log("Swap Debug: Read reserve0 from state", _reserve0);
        console2.log("Swap Debug: Read reserve1 from state", _reserve1);
        console2.log("Swap Debug: isToken0In", isToken0In);
        (uint256 reserveIn, uint256 reserveOut) = isToken0In ? 
            (_reserve0, _reserve1) : 
            (_reserve1, _reserve0);
        console2.log("Swap Debug: Assigned reserveIn", reserveIn); // Log after assignment
        console2.log("Swap Debug: Assigned reserveOut", reserveOut); // Log after assignment

        uint256 currentFee = fee;
        console2.log("Swap Debug: amountIn", amountIn);
        console2.log("Swap Debug: currentFee", currentFee);
        // Slither: Divide-before-multiply - Multiplication before division is used here
        // to calculate the fee-adjusted input amount while maintaining precision.
        // This is standard practice in AMM calculations. Overflow risk is acknowledged.
        uint256 amountInWithFee = (amountIn * (10000 - currentFee)) / 10000;
        console2.log("Swap Debug: amountInWithFee", amountInWithFee);
        console2.log("Swap Debug: reserveIn", reserveIn);
        console2.log("Swap Debug: reserveOut", reserveOut);
        // Slither: Divide-before-multiply - Multiplication before division is used here
        // as part of the constant product formula (x*y=k) calculation for amountOut.
        // This order maintains precision. Overflow risk is acknowledged.
        uint256 _amountOut = (amountInWithFee * reserveOut) / (reserveIn + amountInWithFee); // Use local variable
        console2.log("Swap Debug: calculated amountOut", _amountOut);
        
        require(_amountOut > 0, "INSUFFICIENT_OUTPUT_AMOUNT");
        require(_amountOut <= reserveOut, "OUTPUT_EXCEEDS_RESERVE");

        if (isToken0In) {
            reserve0 = reserveIn + amountIn;
            reserve1 = reserveOut - _amountOut; // Use local variable
        } else {
            reserve1 = reserveIn + amountIn;
            reserve0 = reserveOut - _amountOut; // Use local variable
        }

        // Use msg.sender instead of the removed 'sender' parameter
        TransferHelper.safeTransferFrom(tokenIn, msg.sender, address(this), amountIn);
        address tokenOut = isToken0In ? token1 : token0;

        // Log balances right before transfer
        console2.log("Swap Debug: Pool balance of tokenOut before transfer:", IERC20(tokenOut).balanceOf(address(this)));
        console2.log("Swap Debug: AmountOut to transfer:", _amountOut); // Log local variable

        TransferHelper.safeTransfer(tokenOut, to, _amountOut); // Use local variable

        // Assign to return variable
        amountOut = _amountOut;

        // Emit Swap event (Consider adding this if not handled elsewhere)
        // emit Swap(msg.sender, tokenIn, tokenOut, amountIn, amountOut);
    }

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
