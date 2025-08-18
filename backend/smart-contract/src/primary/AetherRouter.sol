// SPDX-License-Identifier: GPL-3.0

/*
Created by irfndi (github.com/irfndi) - Apr 2025
Email: join.mantap@gmail.com
*/

pragma solidity ^0.8.29;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IAetherPool} from "../interfaces/IAetherPool.sol";
import {IPoolManager} from "../interfaces/IPoolManager.sol";
import {BaseRouter} from "./BaseRouter.sol";
import {IERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Permit.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {Errors} from "../libraries/Errors.sol";
import {PoolKey} from "../../lib/v4-core/src/types/PoolKey.sol";
import {Currency} from "v4-core/types/Currency.sol";
import {IHooks} from "v4-core/interfaces/IHooks.sol";
import {CircuitBreaker} from "../security/CircuitBreaker.sol";
import {RoleManager} from "../access/RoleManager.sol";

/**
 * @title AetherRouter
 * @notice Central entry point for trading operations in AetherDEX
 * @dev Handles swaps, liquidity operations with security controls and gas optimization
 */
contract AetherRouter is BaseRouter, CircuitBreaker {
    /// @notice Pool manager for pool operations
    IPoolManager public immutable poolManager;
    
    /// @notice Role manager for access control
    RoleManager public immutable roleManager;
    
    /// @notice Maximum number of hops allowed in multi-hop swaps
    uint256 public constant MAX_HOPS = 5;
    
    /// @notice Event emitted when a swap is executed
    event Swap(
        address indexed sender,
        address indexed tokenIn,
        address indexed tokenOut,
        uint256 amountIn,
        uint256 amountOut,
        address to
    );
    
    /// @notice Event emitted when a multi-hop swap is executed
    event MultiHopSwap(
        address indexed sender,
        address[] path,
        uint256 amountIn,
        uint256 amountOut,
        address to
    );
    
    /// @notice Modifier to check if caller has operator role
    modifier onlyOperator() override {
        if (!roleManager.hasRole(OPERATOR_ROLE, msg.sender)) {
            revert Errors.NotOwner();
        }
        _;
    }
    
    /**
     * @notice Constructor
     * @param _poolManager Address of the pool manager
     * @param _roleManager Address of the role manager
     * @param admin Address to be granted admin role for CircuitBreaker
     * @param initialGasLimit Initial maximum gas price
     * @param initialValueLimit Initial maximum transaction value
     */
    constructor(
        address _poolManager, 
        address _roleManager,
        address admin,
        uint256 initialGasLimit,
        uint256 initialValueLimit
    ) CircuitBreaker(admin, initialGasLimit, initialValueLimit) {
        if (_poolManager == address(0) || _roleManager == address(0)) {
            revert Errors.ZeroAddress();
        }
        poolManager = IPoolManager(_poolManager);
        roleManager = RoleManager(_roleManager);
    }
    using SafeERC20 for IERC20;

    /**
     * @notice Executes a single token swap
     * @param tokenIn Input token address
     * @param tokenOut Output token address
     * @param amountIn Amount of input tokens
     * @param amountOutMin Minimum amount of output tokens
     * @param to Recipient address
     * @param deadline Transaction deadline
     * @return amountOut Amount of output tokens received
     */
    function executeSwap(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 amountOutMin,
        address to,
        uint256 deadline
    ) external nonReentrant checkDeadline(deadline) whenNotPaused returns (uint256 amountOut) {
        // Input validation
        if (tokenIn == address(0) || tokenOut == address(0)) {
            revert Errors.ZeroAddress();
        }
        if (amountIn == 0) {
            revert Errors.InvalidAmountIn();
        }
        if (to == address(0)) {
            revert Errors.ZeroAddress();
        }
        
        // Check if tokens are blacklisted
        if (isTokenBlacklisted(tokenIn) || isTokenBlacklisted(tokenOut)) {
            revert Errors.TokenBlacklisted();
        }
        
        // Find pool for token pair
        PoolKey memory key = _getPoolKey(tokenIn, tokenOut);
        address pool = poolManager.getPool(key);
        if (pool == address(0)) {
            revert Errors.PoolNotFound();
        }
        
        // Check if pool is paused
        if (poolManager.isPoolPaused(key)) {
            revert Errors.Paused();
        }
        
        // Transfer tokens to pool
        IERC20(tokenIn).safeTransferFrom(msg.sender, pool, amountIn);
        
        // Execute swap
        amountOut = _swap(pool, amountIn, tokenIn, to, amountOutMin);
        
        // Slippage protection
        if (amountOut < amountOutMin) {
            revert Errors.InsufficientOutputAmount();
        }
        
        emit Swap(msg.sender, tokenIn, tokenOut, amountIn, amountOut, to);
    }
    
    /**
     * @notice Executes a multi-hop token swap
     * @param path Array of token addresses for the swap path
     * @param amountIn Amount of input tokens
     * @param amountOutMin Minimum amount of output tokens
     * @param to Recipient address
     * @param deadline Transaction deadline
     * @return amounts Array of amounts for each step
     */
    function executeMultiHopSwap(
        address[] calldata path,
        uint256 amountIn,
        uint256 amountOutMin,
        address to,
        uint256 deadline
    ) public nonReentrant checkDeadline(deadline) whenNotPaused returns (uint256[] memory amounts) {
        // Input validation
        if (path.length < 2) {
            revert Errors.InvalidPath();
        }
        if (path.length > MAX_HOPS + 1) {
            revert Errors.TooManyHops();
        }
        if (amountIn == 0) {
            revert Errors.InvalidAmountIn();
        }
        if (to == address(0)) {
            revert Errors.ZeroAddress();
        }
        
        // Check if any tokens are blacklisted
        for (uint256 i = 0; i < path.length; i++) {
            if (isTokenBlacklisted(path[i])) {
                revert Errors.TokenBlacklisted();
            }
        }
        
        amounts = new uint256[](path.length);
        amounts[0] = amountIn;
        
        // Transfer initial tokens from sender
        IERC20(path[0]).safeTransferFrom(msg.sender, address(this), amountIn);
        
        // Execute swaps for each hop
        for (uint256 i = 0; i < path.length - 1; i++) {
            address tokenIn = path[i];
            address tokenOut = path[i + 1];
            
            // Find pool for this hop
            PoolKey memory key = _getPoolKey(tokenIn, tokenOut);
            address pool = poolManager.getPool(key);
            if (pool == address(0)) {
                revert Errors.PoolNotFound();
            }
            
            // Check if pool is paused
            if (poolManager.isPoolPaused(key)) {
                revert Errors.Paused();
            }
            
            // Transfer tokens to pool
            IERC20(tokenIn).safeTransfer(pool, amounts[i]);
            
            // Execute swap (send to next pool or final recipient)
            address recipient = (i == path.length - 2) ? to : address(this);
            amounts[i + 1] = _swap(pool, amounts[i], tokenIn, recipient, 0);
        }
        
        // Final slippage protection
        if (amounts[amounts.length - 1] < amountOutMin) {
            revert Errors.InsufficientOutputAmount();
        }
        
        emit MultiHopSwap(msg.sender, path, amountIn, amounts[amounts.length - 1], to);
    }
    
    function addLiquidity(
        address pool,
        uint256 amountADesired,
        uint256 amountBDesired,
        uint256 amountAMin,
        uint256 amountBMin,
        address to,
        uint256 deadline
    ) external nonReentrant checkDeadline(deadline) whenNotPaused returns (uint256 amountA, uint256 amountB, uint256 liquidity) {
        if (pool == address(0)) {
            revert Errors.ZeroAddress();
        }
        if (to == address(0)) {
            revert Errors.ZeroAddress();
        }
        
        // Get pool tokens
        (address token0, address token1) = IAetherPool(pool).tokens();
        
        // Transfer tokens to pool
        IERC20(token0).safeTransferFrom(msg.sender, pool, amountADesired);
        IERC20(token1).safeTransferFrom(msg.sender, pool, amountBDesired);
        
        // Calculate liquidity amount (simplified - use geometric mean)
        uint128 liquidityAmount = uint128(Math.sqrt(amountADesired * amountBDesired));
        
        // Mint liquidity
        (uint256 amount0, uint256 amount1) = IAetherPool(pool).mint(to, liquidityAmount);
        liquidity = uint256(liquidityAmount);
        
        // Set actual amounts (simplified - in real implementation would calculate optimal amounts)
        amountA = amountADesired;
        amountB = amountBDesired;
        
        // Slippage protection
        if (amountA < amountAMin) {
            revert Errors.InsufficientAAmount();
        }
        if (amountB < amountBMin) {
            revert Errors.InsufficientBAmount();
        }
    }

    function removeLiquidity(
        address pool,
        uint256 liquidity,
        uint256 amountAMin,
        uint256 amountBMin,
        address to,
        uint256 deadline
    ) external nonReentrant checkDeadline(deadline) whenNotPaused returns (uint256 amountA, uint256 amountB) {
        if (pool == address(0)) {
            revert Errors.ZeroAddress();
        }
        if (to == address(0)) {
            revert Errors.ZeroAddress();
        }
        
        _transferToPool(pool, pool, liquidity);
        (amountA, amountB) = IAetherPool(pool).burn(to, liquidity);
        
        if (amountA < amountAMin) {
            revert Errors.InsufficientAAmount();
        }
        if (amountB < amountBMin) {
            revert Errors.InsufficientBAmount();
        }
    }

    function swapExactTokensForTokens(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external nonReentrant checkDeadline(deadline) whenNotPaused returns (uint256[] memory amounts) {
        if (path.length < 2) {
            revert Errors.InvalidPath();
        }
        if (to == address(0)) {
            revert Errors.ZeroAddress();
        }
        
        // Use executeMultiHopSwap for multi-token paths
        if (path.length > 2) {
            return executeMultiHopSwap(path, amountIn, amountOutMin, to, deadline);
        }
        
        // Single hop swap
        amounts = new uint256[](2);
        amounts[0] = amountIn;
        
        // Find pool for token pair
        PoolKey memory key = _getPoolKey(path[0], path[1]);
        address pool = poolManager.getPool(key);
        if (pool == address(0)) {
            revert Errors.PoolNotFound();
        }
        
        _transferToPool(path[0], pool, amountIn);
        uint256 amountOut = _swap(pool, amountIn, path[0], to, amountOutMin);
        amounts[1] = amountOut;
        
        if (amountOut < amountOutMin) {
            revert Errors.InsufficientOutputAmount();
        }
    }

    // Helper function to call permit on a token
    function _permitToken(
        IERC20Permit token,
        address owner,
        address spender,
        uint256 amount,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) private {
        // Cast to IERC20 to call allowance, as IERC20Permit does not define it.
        if (IERC20(address(token)).allowance(owner, spender) < amount) {
            token.permit(owner, spender, amount, deadline, v, r, s);
        }
    }

    function swapExactTokensForTokensWithPermit(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline, // Deadline for the swap itself
        uint256 permitDeadline, // Deadline for the permit signature
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external nonReentrant checkDeadline(deadline) whenNotPaused returns (uint256[] memory amounts) {
        if (path.length < 2) {
            revert Errors.InvalidPath();
        }
        if (to == address(0)) {
            revert Errors.ZeroAddress();
        }

        // Permit the router to spend tokenIn on behalf of msg.sender
        _permitToken(IERC20Permit(path[0]), msg.sender, address(this), amountIn, permitDeadline, v, r, s);

        // Use executeMultiHopSwap for the actual swap logic
        return executeMultiHopSwap(path, amountIn, amountOutMin, to, deadline);
    }
    
    /**
     * @notice Creates a pool key for token pair with default parameters
     * @param tokenA First token address
     * @param tokenB Second token address
     * @return key The pool key
     */
    function _getPoolKey(address tokenA, address tokenB) internal pure returns (PoolKey memory key) {
        // Ensure consistent token ordering
        if (tokenA > tokenB) {
            (tokenA, tokenB) = (tokenB, tokenA);
        }
        
        return PoolKey({
            currency0: Currency.wrap(tokenA),
            currency1: Currency.wrap(tokenB),
            fee: 3000, // Default 0.3% fee
            tickSpacing: 60, // Default tick spacing
            hooks: IHooks(address(0)) // No hooks by default
        });
    }
    
    /**
     * @notice Emergency pause function
     * @dev Only callable by admin role
     */
    function emergencyPause() external onlyOperator {
        _pause();
    }
    
    /**
     * @notice Emergency unpause function
     * @dev Only callable by admin role
     */
    function emergencyUnpause() external onlyOperator {
        _unpause();
    }

    /**
     * @notice Checks if a token is blacklisted
     * @param token Token address to check
     * @return true if token is blacklisted
     */
    function isTokenBlacklisted(address token) public view override returns (bool) {
        // For now, return false - can be extended with actual blacklist logic
        // This could check against a mapping or external registry
        return false;
    }

    modifier checkDeadline(uint256 deadline) override {
        if (deadline < block.timestamp) {
            revert Errors.DeadlineExpired();
        }
        _;
    }
}
