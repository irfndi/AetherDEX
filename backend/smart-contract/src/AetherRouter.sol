// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IPoolManager} from "./interfaces/IPoolManager.sol";
import {PoolKey} from "./types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "v4-core/types/PoolId.sol";
import {Currency, CurrencyLibrary} from "v4-core/types/Currency.sol";
import {BalanceDelta} from "./types/BalanceDelta.sol";
import {IHooks} from "v4-core/interfaces/IHooks.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";

/**
 * @title AetherRouter
 * @notice Advanced router for AetherDEX with multi-hop swaps, optimal path finding, and slippage protection
 * @dev Implements sophisticated routing algorithms for optimal trade execution
 */
contract AetherRouter is ReentrancyGuard, Ownable, Pausable {
    using PoolIdLibrary for PoolKey;
    using CurrencyLibrary for Currency;
    using SafeERC20 for IERC20;

    // Core dependencies
    IPoolManager public immutable poolManager;
    
    // Router configuration
    uint256 public constant MAX_HOPS = 4;
    uint256 public constant MAX_SLIPPAGE = 5000; // 50% max slippage
    uint256 public constant DEFAULT_DEADLINE = 20 minutes;
    uint256 public constant BASIS_POINTS = 10000;
    
    // Fee configuration
    uint256 public routerFee = 5; // 0.05% router fee
    address public feeRecipient;
    
    // Path finding configuration
    uint256 public maxPathsToCheck = 10;
    uint256 public minLiquidityThreshold = 1000e18; // Minimum liquidity for path consideration
    
    // Supported tokens for routing
    mapping(address => bool) public supportedTokens;
    address[] public tokenList;
    
    // Pool registry for path finding
    mapping(bytes32 => PoolInfo) public pools;
    mapping(address => address[]) public tokenConnections; // token -> connected tokens
    
    struct PoolInfo {
        PoolKey key;
        bool active;
        uint256 liquidity;
        uint256 fee;
        uint32 lastUpdate;
    }
    
    struct SwapParams {
        address tokenIn;
        address tokenOut;
        uint256 amountIn;
        uint256 amountOutMinimum;
        address recipient;
        uint256 deadline;
        bytes path; // Encoded path for multi-hop
    }
    
    struct ExactOutputParams {
        address tokenIn;
        address tokenOut;
        uint256 amountOut;
        uint256 amountInMaximum;
        address recipient;
        uint256 deadline;
        bytes path;
    }
    
    struct PathInfo {
        address[] tokens;
        PoolKey[] pools;
        uint256 expectedOutput;
        uint256 priceImpact;
        uint256 gasEstimate;
    }
    
    struct QuoteResult {
        uint256 amountOut;
        uint256 priceImpact;
        uint256 gasEstimate;
        PathInfo bestPath;
        PathInfo[] alternativePaths;
    }
    
    // Events
    event SwapExecuted(
        address indexed tokenIn,
        address indexed tokenOut,
        uint256 amountIn,
        uint256 amountOut,
        address indexed recipient,
        bytes path
    );
    
    event PathOptimized(
        address indexed tokenIn,
        address indexed tokenOut,
        uint256 originalOutput,
        uint256 optimizedOutput,
        bytes originalPath,
        bytes optimizedPath
    );
    
    event PoolRegistered(
        bytes32 indexed poolId,
        address indexed token0,
        address indexed token1,
        uint24 fee
    );
    
    event RouterFeeUpdated(uint256 oldFee, uint256 newFee);
    event FeeRecipientUpdated(address oldRecipient, address newRecipient);
    event TokenSupported(address indexed token, bool supported);
    
    // Errors
    error InvalidPath();
    error InsufficientOutput();
    error ExcessiveInput();
    error DeadlineExpired();
    error InvalidSlippage();
    error UnsupportedToken();
    error InsufficientLiquidity();
    error PathTooLong();
    error InvalidFee();
    error ZeroAmount();
    error IdenticalTokens();
    
    constructor(
        IPoolManager _poolManager,
        address _feeRecipient,
        address _initialOwner
    ) Ownable(_initialOwner) {
        poolManager = _poolManager;
        feeRecipient = _feeRecipient;
    }
    
    /**
     * @notice Execute exact input swap with optimal path finding
     * @param params Swap parameters
     * @return amountOut Amount of tokens received
     */
    function exactInputSingle(SwapParams calldata params) 
        external 
        payable 
        nonReentrant 
        whenNotPaused 
        returns (uint256 amountOut) 
    {
        _validateSwapParams(params);
        
        // Find optimal path
        PathInfo memory optimalPath = _findOptimalPath(
            params.tokenIn,
            params.tokenOut,
            params.amountIn,
            true // exactInput
        );
        
        // Execute swap
        amountOut = _executeSwap(
            params.tokenIn,
            params.tokenOut,
            params.amountIn,
            params.amountOutMinimum,
            params.recipient,
            optimalPath,
            true // exactInput
        );
        
        emit SwapExecuted(
            params.tokenIn,
            params.tokenOut,
            params.amountIn,
            amountOut,
            params.recipient,
            _encodePath(optimalPath)
        );
    }
    
    /**
     * @notice Execute exact output swap with optimal path finding
     * @param params Swap parameters
     * @return amountIn Amount of tokens spent
     */
    function exactOutputSingle(ExactOutputParams calldata params)
        external
        payable
        nonReentrant
        whenNotPaused
        returns (uint256 amountIn)
    {
        _validateExactOutputParams(params);
        
        // Find optimal path for exact output
        PathInfo memory optimalPath = _findOptimalPath(
            params.tokenIn,
            params.tokenOut,
            params.amountOut,
            false // exactOutput
        );
        
        // Execute swap
        amountIn = _executeSwap(
            params.tokenIn,
            params.tokenOut,
            params.amountInMaximum,
            params.amountOut,
            params.recipient,
            optimalPath,
            false // exactInput
        );
        
        emit SwapExecuted(
            params.tokenIn,
            params.tokenOut,
            amountIn,
            params.amountOut,
            params.recipient,
            _encodePath(optimalPath)
        );
    }
    
    /**
     * @notice Execute multi-hop swap with custom path
     * @param path Encoded path of tokens and fees
     * @param amountIn Amount of input tokens
     * @param amountOutMinimum Minimum amount of output tokens
     * @param recipient Address to receive output tokens
     * @return amountOut Amount of tokens received
     */
    function exactInputMultiHop(
        bytes calldata path,
        uint256 amountIn,
        uint256 amountOutMinimum,
        address recipient
    ) external payable nonReentrant whenNotPaused returns (uint256 amountOut) {
        if (amountIn == 0) revert ZeroAmount();
        
        PathInfo memory pathInfo = _decodePath(path);
        if (pathInfo.tokens.length > MAX_HOPS + 1) revert PathTooLong();
        
        amountOut = _executeMultiHopSwap(
            pathInfo,
            amountIn,
            amountOutMinimum,
            recipient,
            true // exactInput
        );
        
        emit SwapExecuted(
            pathInfo.tokens[0],
            pathInfo.tokens[pathInfo.tokens.length - 1],
            amountIn,
            amountOut,
            recipient,
            path
        );
    }
    
    /**
     * @notice Get quote for swap with multiple path options
     * @param tokenIn Input token address
     * @param tokenOut Output token address
     * @param amountIn Amount of input tokens
     * @return quote Detailed quote with best and alternative paths
     */
    function getQuote(
        address tokenIn,
        address tokenOut,
        uint256 amountIn
    ) external view returns (QuoteResult memory quote) {
        if (!supportedTokens[tokenIn] || !supportedTokens[tokenOut]) {
            revert UnsupportedToken();
        }
        if (tokenIn == tokenOut) revert IdenticalTokens();
        if (amountIn == 0) revert ZeroAmount();
        
        // Find multiple paths
        PathInfo[] memory paths = _findMultiplePaths(tokenIn, tokenOut, amountIn);
        
        if (paths.length == 0) {
            revert InsufficientLiquidity();
        }
        
        // Select best path
        uint256 bestIndex = _selectBestPath(paths);
        
        quote.bestPath = paths[bestIndex];
        quote.amountOut = paths[bestIndex].expectedOutput;
        quote.priceImpact = paths[bestIndex].priceImpact;
        quote.gasEstimate = paths[bestIndex].gasEstimate;
        
        // Populate alternative paths
        quote.alternativePaths = new PathInfo[](paths.length - 1);
        uint256 altIndex = 0;
        for (uint256 i = 0; i < paths.length; i++) {
            if (i != bestIndex) {
                quote.alternativePaths[altIndex] = paths[i];
                altIndex++;
            }
        }
    }
    
    /**
     * @notice Register a new pool for routing
     * @param key Pool key
     * @param liquidity Initial liquidity estimate
     */
    function registerPool(
        PoolKey calldata key,
        uint256 liquidity
    ) external onlyOwner {
        bytes32 poolId = keccak256(abi.encode(key.currency0, key.currency1, key.fee, key.tickSpacing, key.hooks));
        
        pools[poolId] = PoolInfo({
            key: key,
            active: true,
            liquidity: liquidity,
            fee: key.fee,
            lastUpdate: uint32(block.timestamp)
        });
        
        address token0 = Currency.unwrap(key.currency0);
        address token1 = Currency.unwrap(key.currency1);
        
        // Update token connections
        _addTokenConnection(token0, token1);
        _addTokenConnection(token1, token0);
        
        emit PoolRegistered(poolId, token0, token1, key.fee);
    }
    
    /**
     * @notice Update pool liquidity information
     * @param poolId Pool identifier
     * @param liquidity New liquidity amount
     */
    function updatePoolLiquidity(
        bytes32 poolId,
        uint256 liquidity
    ) external {
        // In production, this should have proper access control or be automated
        PoolInfo storage pool = pools[poolId];
        if (!pool.active) revert InvalidPath();
        
        pool.liquidity = liquidity;
        pool.lastUpdate = uint32(block.timestamp);
    }
    
    /**
     * @notice Add or remove token from supported list
     * @param token Token address
     * @param supported Whether token is supported
     */
    function setSupportedToken(address token, bool supported) external onlyOwner {
        if (supportedTokens[token] != supported) {
            supportedTokens[token] = supported;
            
            if (supported) {
                tokenList.push(token);
            } else {
                // Remove from tokenList
                for (uint256 i = 0; i < tokenList.length; i++) {
                    if (tokenList[i] == token) {
                        tokenList[i] = tokenList[tokenList.length - 1];
                        tokenList.pop();
                        break;
                    }
                }
            }
            
            emit TokenSupported(token, supported);
        }
    }
    
    /**
     * @notice Update router fee
     * @param newFee New fee in basis points
     */
    function setRouterFee(uint256 newFee) external onlyOwner {
        if (newFee > 100) revert InvalidFee(); // Max 1%
        
        uint256 oldFee = routerFee;
        routerFee = newFee;
        
        emit RouterFeeUpdated(oldFee, newFee);
    }
    
    /**
     * @notice Update fee recipient
     * @param newRecipient New fee recipient address
     */
    function setFeeRecipient(address newRecipient) external onlyOwner {
        address oldRecipient = feeRecipient;
        feeRecipient = newRecipient;
        
        emit FeeRecipientUpdated(oldRecipient, newRecipient);
    }
    
    /**
     * @notice Emergency pause function
     */
    function pause() external onlyOwner {
        _pause();
    }
    
    /**
     * @notice Unpause function
     */
    function unpause() external onlyOwner {
        _unpause();
    }
    
    // ============ INTERNAL FUNCTIONS ============
    
    /**
     * @notice Find optimal path for a swap
     * @param tokenIn Input token
     * @param tokenOut Output token
     * @param amount Amount to swap
     * @param exactInput Whether this is exact input or output
     * @return Optimal path information
     */
    function _findOptimalPath(
        address tokenIn,
        address tokenOut,
        uint256 amount,
        bool exactInput
    ) internal view returns (PathInfo memory) {
        PathInfo[] memory paths = _findMultiplePaths(tokenIn, tokenOut, amount);
        
        if (paths.length == 0) {
            revert InsufficientLiquidity();
        }
        
        uint256 bestIndex = _selectBestPath(paths);
        return paths[bestIndex];
    }
    
    /**
     * @notice Find multiple possible paths between two tokens
     * @param tokenIn Input token
     * @param tokenOut Output token
     * @param amountIn Input amount
     * @return Array of possible paths
     */
    function _findMultiplePaths(
        address tokenIn,
        address tokenOut,
        uint256 amountIn
    ) internal view returns (PathInfo[] memory) {
        PathInfo[] memory allPaths = new PathInfo[](maxPathsToCheck);
        uint256 pathCount = 0;
        
        // Direct path
        PathInfo memory directPath = _findDirectPath(tokenIn, tokenOut, amountIn);
        if (directPath.expectedOutput > 0) {
            allPaths[pathCount] = directPath;
            pathCount++;
        }
        
        // Multi-hop paths through intermediate tokens
        address[] memory intermediateTokens = _getIntermediateTokens(tokenIn, tokenOut);
        
        for (uint256 i = 0; i < intermediateTokens.length && pathCount < maxPathsToCheck; i++) {
            address intermediate = intermediateTokens[i];
            
            // Two-hop path: tokenIn -> intermediate -> tokenOut
            PathInfo memory twoHopPath = _findTwoHopPath(tokenIn, intermediate, tokenOut, amountIn);
            if (twoHopPath.expectedOutput > 0) {
                allPaths[pathCount] = twoHopPath;
                pathCount++;
            }
            
            // Three-hop paths if we have room
            if (pathCount < maxPathsToCheck - 1) {
                for (uint256 j = i + 1; j < intermediateTokens.length && pathCount < maxPathsToCheck; j++) {
                    address intermediate2 = intermediateTokens[j];
                    PathInfo memory threeHopPath = _findThreeHopPath(
                        tokenIn, intermediate, intermediate2, tokenOut, amountIn
                    );
                    if (threeHopPath.expectedOutput > 0) {
                        allPaths[pathCount] = threeHopPath;
                        pathCount++;
                    }
                }
            }
        }
        
        // Resize array to actual path count
        PathInfo[] memory validPaths = new PathInfo[](pathCount);
        for (uint256 i = 0; i < pathCount; i++) {
            validPaths[i] = allPaths[i];
        }
        
        return validPaths;
    }
    
    /**
     * @notice Find direct path between two tokens
     * @param tokenIn Input token
     * @param tokenOut Output token
     * @param amountIn Input amount
     * @return path Direct path information
     */
    function _findDirectPath(
        address tokenIn,
        address tokenOut,
        uint256 amountIn
    ) internal view returns (PathInfo memory path) {
        PoolKey memory poolKey = _findBestPool(tokenIn, tokenOut);
        
        if (poolKey.currency0 == Currency.wrap(address(0))) {
            return path; // No pool found
        }
        
        path.tokens = new address[](2);
        path.tokens[0] = tokenIn;
        path.tokens[1] = tokenOut;
        
        path.pools = new PoolKey[](1);
        path.pools[0] = poolKey;
        
        // Estimate output and price impact
        (path.expectedOutput, path.priceImpact) = _estimateSwapOutput(poolKey, tokenIn, amountIn);
        path.gasEstimate = 150000; // Base gas for single swap
    }
    
    /**
     * @notice Find two-hop path through intermediate token
     * @param tokenIn Input token
     * @param intermediate Intermediate token
     * @param tokenOut Output token
     * @param amountIn Input amount
     * @return path Two-hop path information
     */
    function _findTwoHopPath(
        address tokenIn,
        address intermediate,
        address tokenOut,
        uint256 amountIn
    ) internal view returns (PathInfo memory path) {
        PoolKey memory pool1 = _findBestPool(tokenIn, intermediate);
        PoolKey memory pool2 = _findBestPool(intermediate, tokenOut);
        
        if (pool1.currency0 == Currency.wrap(address(0)) || 
            pool2.currency0 == Currency.wrap(address(0))) {
            return path; // Missing pool
        }
        
        path.tokens = new address[](3);
        path.tokens[0] = tokenIn;
        path.tokens[1] = intermediate;
        path.tokens[2] = tokenOut;
        
        path.pools = new PoolKey[](2);
        path.pools[0] = pool1;
        path.pools[1] = pool2;
        
        // Estimate output through two hops
        (uint256 intermediateAmount, uint256 impact1) = _estimateSwapOutput(pool1, tokenIn, amountIn);
        
        uint256 secondImpact;
        (path.expectedOutput, secondImpact) = _estimateSwapOutput(pool2, intermediate, intermediateAmount);
        
        path.priceImpact = impact1 + secondImpact;
        path.gasEstimate = 280000; // Gas for two swaps
    }
    
    /**
     * @notice Find three-hop path through two intermediate tokens
     * @param tokenIn Input token
     * @param intermediate1 First intermediate token
     * @param intermediate2 Second intermediate token
     * @param tokenOut Output token
     * @param amountIn Input amount
     * @return path Three-hop path information
     */
    function _findThreeHopPath(
        address tokenIn,
        address intermediate1,
        address intermediate2,
        address tokenOut,
        uint256 amountIn
    ) internal view returns (PathInfo memory path) {
        PoolKey memory pool1 = _findBestPool(tokenIn, intermediate1);
        PoolKey memory pool2 = _findBestPool(intermediate1, intermediate2);
        PoolKey memory pool3 = _findBestPool(intermediate2, tokenOut);
        
        if (pool1.currency0 == Currency.wrap(address(0)) || 
            pool2.currency0 == Currency.wrap(address(0)) ||
            pool3.currency0 == Currency.wrap(address(0))) {
            return path; // Missing pool
        }
        
        path.tokens = new address[](4);
        path.tokens[0] = tokenIn;
        path.tokens[1] = intermediate1;
        path.tokens[2] = intermediate2;
        path.tokens[3] = tokenOut;
        
        path.pools = new PoolKey[](3);
        path.pools[0] = pool1;
        path.pools[1] = pool2;
        path.pools[2] = pool3;
        
        // Estimate output through three hops
        (uint256 amount1, uint256 impact1) = _estimateSwapOutput(pool1, tokenIn, amountIn);
        (uint256 amount2, uint256 impact2) = _estimateSwapOutput(pool2, intermediate1, amount1);
        
        uint256 impact3;
        (path.expectedOutput, impact3) = _estimateSwapOutput(pool3, intermediate2, amount2);
        
        path.priceImpact = impact1 + impact2 + impact3;
        path.gasEstimate = 420000; // Gas for three swaps
    }
    
    /**
     * @notice Select best path from multiple options
     * @param paths Array of path options
     * @return bestIndex Index of best path
     */
    function _selectBestPath(PathInfo[] memory paths) internal pure returns (uint256) {
        uint256 bestIndex = 0;
        uint256 bestScore = 0;
        
        for (uint256 i = 0; i < paths.length; i++) {
            // Score = output amount - (price impact penalty) - (gas penalty)
            uint256 score = paths[i].expectedOutput;
            
            // Penalize high price impact (reduce score by impact percentage)
            if (paths[i].priceImpact > 0) {
                uint256 impactPenalty = (paths[i].expectedOutput * paths[i].priceImpact) / BASIS_POINTS;
                score = score > impactPenalty ? score - impactPenalty : 0;
            }
            
            // Penalize high gas costs (assume 20 gwei gas price, $2000 ETH)
            uint256 gasCostInWei = paths[i].gasEstimate * 20e9; // 20 gwei
            uint256 gasCostPenalty = gasCostInWei / 1e12; // Rough conversion to token units
            score = score > gasCostPenalty ? score - gasCostPenalty : 0;
            
            if (score > bestScore) {
                bestScore = score;
                bestIndex = i;
            }
        }
        
        return bestIndex;
     }
     
     /**
      * @notice Execute swap with given path
      * @param tokenIn Input token
      * @param tokenOut Output token
      * @param amountIn Input amount (or max for exact output)
      * @param amountOutMin Minimum output (or exact output for exact output)
      * @param recipient Recipient address
      * @param path Path information
      * @param exactInput Whether this is exact input swap
      * @return finalAmount Amount out (or amount in for exact output)
      */
     function _executeSwap(
         address tokenIn,
         address tokenOut,
         uint256 amountIn,
         uint256 amountOutMin,
         address recipient,
         PathInfo memory path,
         bool exactInput
     ) internal returns (uint256) {
         // Transfer tokens from user
         IERC20(tokenIn).safeTransferFrom(msg.sender, address(this), amountIn);
         
         // Execute multi-hop swap
         uint256 finalAmount = _executeMultiHopSwap(
             path,
             amountIn,
             amountOutMin,
             recipient,
             exactInput
         );
         
         // Collect router fee if configured
         if (routerFee > 0 && feeRecipient != address(0)) {
             uint256 fee = (finalAmount * routerFee) / BASIS_POINTS;
             if (fee > 0) {
                 IERC20(tokenOut).safeTransfer(feeRecipient, fee);
                 finalAmount -= fee;
             }
         }
         
         return finalAmount;
     }
     
     /**
      * @notice Execute multi-hop swap through path
      * @param path Path information
      * @param amountIn Input amount
      * @param amountOutMin Minimum output amount
      * @param recipient Final recipient
      * @param exactInput Whether exact input or output
      * @return currentAmount Final amount
      */
     function _executeMultiHopSwap(
         PathInfo memory path,
         uint256 amountIn,
         uint256 amountOutMin,
         address recipient,
         bool exactInput
     ) internal returns (uint256) {
         uint256 currentAmount = amountIn;
         address currentRecipient;
         
         for (uint256 i = 0; i < path.pools.length; i++) {
             // Determine recipient for this hop
             if (i == path.pools.length - 1) {
                 currentRecipient = recipient; // Final hop goes to recipient
             } else {
                 currentRecipient = address(this); // Intermediate hops stay in router
             }
             
             // Execute single swap
             currentAmount = _executeSingleSwap(
                 path.pools[i],
                 path.tokens[i],
                 path.tokens[i + 1],
                 currentAmount,
                 currentRecipient
             );
         }
         
         // Validate slippage
         if (exactInput && currentAmount < amountOutMin) {
             revert InsufficientOutput();
         }
         
         return currentAmount;
     }
     
     /**
      * @notice Execute single swap in a pool
      * @param poolKey Pool to swap in
      * @param tokenIn Input token
      * @param tokenOut Output token
      * @param amountIn Input amount
      * @param recipient Recipient address
      * @return amountOut Amount out
      */
     function _executeSingleSwap(
         PoolKey memory poolKey,
         address tokenIn,
         address tokenOut,
         uint256 amountIn,
         address recipient
     ) internal returns (uint256) {
         // Determine swap direction
         bool zeroForOne = tokenIn < tokenOut;
         
         // Prepare swap parameters
         IPoolManager.SwapParams memory swapParams = IPoolManager.SwapParams({
             zeroForOne: zeroForOne,
             amountSpecified: int256(amountIn),
             sqrtPriceLimitX96: zeroForOne ? 4295128739 : 1461446703485210103287273052203988822378723970341
         });
         
         // Execute swap through pool manager
         // Note: We need to use a workaround for the memory to calldata conversion
         BalanceDelta memory delta = _performSwap(poolKey, swapParams);
         
         // Calculate output amount
         uint256 amountOut = zeroForOne ? 
             uint256(-delta.amount1) : 
             uint256(-delta.amount0);
             
         // Transfer output tokens to recipient
         IERC20(tokenOut).safeTransfer(recipient, amountOut);
         
         return amountOut;
     }
     
     /**
      * @notice Find best pool for token pair
      * @param tokenA First token
      * @param tokenB Second token
      * @return Best pool key
      */
     function _findBestPool(
         address tokenA,
         address tokenB
     ) internal view returns (PoolKey memory) {
         PoolKey memory bestPool;
         uint256 bestLiquidity = 0;
         
         // Standard fee tiers to check
         uint24[4] memory feeTiers = [uint24(100), 500, 3000, 10000]; // 0.01%, 0.05%, 0.3%, 1%
         
         for (uint256 i = 0; i < feeTiers.length; i++) {
             PoolKey memory poolKey = PoolKey({
                 currency0: Currency.wrap(tokenA < tokenB ? tokenA : tokenB),
                 currency1: Currency.wrap(tokenA < tokenB ? tokenB : tokenA),
                 fee: feeTiers[i],
                 tickSpacing: _getTickSpacing(feeTiers[i]),
                 hooks: IHooks(address(0))
             });
             
             bytes32 poolId = keccak256(abi.encode(poolKey.currency0, poolKey.currency1, poolKey.fee, poolKey.tickSpacing, poolKey.hooks));
             PoolInfo storage poolInfo = pools[poolId];
             
             if (poolInfo.active && poolInfo.liquidity > bestLiquidity && 
                 poolInfo.liquidity >= minLiquidityThreshold) {
                 bestLiquidity = poolInfo.liquidity;
                 bestPool = poolKey;
             }
         }
         
         return bestPool;
     }
     
     /**
      * @notice Get intermediate tokens for routing
      * @param tokenIn Input token
      * @param tokenOut Output token
      * @return Array of intermediate tokens
      */
     function _getIntermediateTokens(
         address tokenIn,
         address tokenOut
     ) internal view returns (address[] memory) {
         address[] memory candidates = new address[](tokenList.length);
         uint256 count = 0;
         
         for (uint256 i = 0; i < tokenList.length; i++) {
             address token = tokenList[i];
             if (token != tokenIn && token != tokenOut && supportedTokens[token]) {
                 // Check if this token has connections to both input and output
                 if (_hasConnection(tokenIn, token) && _hasConnection(token, tokenOut)) {
                     candidates[count] = token;
                     count++;
                 }
             }
         }
         
         // Resize to actual count
         address[] memory intermediates = new address[](count);
         for (uint256 i = 0; i < count; i++) {
             intermediates[i] = candidates[i];
         }
         
         return intermediates;
     }
     
     /**
      * @notice Check if two tokens have a direct connection
      * @param tokenA First token
      * @param tokenB Second token
      * @return Whether connection exists
      */
     function _hasConnection(address tokenA, address tokenB) internal view returns (bool) {
         address[] storage connections = tokenConnections[tokenA];
         for (uint256 i = 0; i < connections.length; i++) {
             if (connections[i] == tokenB) {
                 return true;
             }
         }
         return false;
     }
     
     /**
      * @notice Add token connection
      * @param tokenA First token
      * @param tokenB Second token
      */
     function _addTokenConnection(address tokenA, address tokenB) internal {
         if (!_hasConnection(tokenA, tokenB)) {
             tokenConnections[tokenA].push(tokenB);
         }
     }
     
     /**
      * @notice Estimate swap output and price impact
      * @param poolKey Pool to swap in
      * @param tokenIn Input token
      * @param amountIn Input amount
      * @return amountOut Estimated output amount
      * @return priceImpact Price impact in basis points
      */
     function _estimateSwapOutput(
         PoolKey memory poolKey,
         address tokenIn,
         uint256 amountIn
     ) internal view returns (uint256 amountOut, uint256 priceImpact) {
         // Simplified estimation - in production, this would use more sophisticated math
         bytes32 poolId = keccak256(abi.encode(poolKey.currency0, poolKey.currency1, poolKey.fee, poolKey.tickSpacing, poolKey.hooks));
         PoolInfo storage poolInfo = pools[poolId];
         
         if (!poolInfo.active || poolInfo.liquidity == 0) {
             return (0, 0);
         }
         
         // Simple constant product formula estimation
         // This is a simplified version - real implementation would use Uniswap V4 math
         uint256 fee = poolKey.fee;
         uint256 amountInWithFee = (amountIn * (1000000 - fee)) / 1000000;
         
         // Estimate based on liquidity (simplified)
         amountOut = (amountInWithFee * poolInfo.liquidity) / (poolInfo.liquidity + amountInWithFee);
         
         // Calculate price impact
         if (poolInfo.liquidity > 0) {
             priceImpact = (amountIn * BASIS_POINTS) / poolInfo.liquidity;
             if (priceImpact > BASIS_POINTS) priceImpact = BASIS_POINTS; // Cap at 100%
         }
     }
     
     /**
      * @notice Get tick spacing for fee tier
      * @param fee Fee tier
      * @return Tick spacing
      */
     function _getTickSpacing(uint24 fee) internal pure returns (int24) {
         if (fee == 100) return 1;
         if (fee == 500) return 10;
         if (fee == 3000) return 60;
         if (fee == 10000) return 200;
         return 60; // Default
     }
     
     /**
      * @notice Encode path information
      * @param path Path information
      * @return Encoded path bytes
      */
     function _encodePath(PathInfo memory path) internal pure returns (bytes memory) {
         bytes memory encoded = abi.encode(path.tokens, path.pools);
         return encoded;
     }
     
     /**
      * @notice Decode path from bytes
      * @param pathBytes Encoded path
      * @return Decoded path information
      */
     function _decodePath(bytes memory pathBytes) internal pure returns (PathInfo memory) {
        (address[] memory tokens, PoolKey[] memory decodedPools) = abi.decode(pathBytes, (address[], PoolKey[]));
        
        PathInfo memory path;
        path.tokens = tokens;
        path.pools = decodedPools;
        
        return path;
    }
     
     /**
      * @notice Validate swap parameters
      * @param params Swap parameters
      */
     function _validateSwapParams(SwapParams calldata params) internal view {
         if (params.deadline < block.timestamp) revert DeadlineExpired();
         if (params.amountIn == 0) revert ZeroAmount();
         if (params.tokenIn == params.tokenOut) revert IdenticalTokens();
         if (!supportedTokens[params.tokenIn] || !supportedTokens[params.tokenOut]) {
             revert UnsupportedToken();
         }
     }
     
     /**
      * @notice Validate exact output parameters
      * @param params Exact output parameters
      */
     function _validateExactOutputParams(ExactOutputParams calldata params) internal view {
         if (params.deadline < block.timestamp) revert DeadlineExpired();
         if (params.amountOut == 0) revert ZeroAmount();
         if (params.tokenIn == params.tokenOut) revert IdenticalTokens();
         if (!supportedTokens[params.tokenIn] || !supportedTokens[params.tokenOut]) {
             revert UnsupportedToken();
         }
     }

     /**
      * @notice Helper function to perform swap with proper type conversion
      * @param poolKey Pool key for the swap
      * @param swapParams Swap parameters
      * @return delta Balance delta from the swap
      */
     function _performSwap(
         PoolKey memory poolKey,
         IPoolManager.SwapParams memory swapParams
     ) internal returns (BalanceDelta memory delta) {
         // Use assembly to convert memory to calldata for the function call
         bytes memory poolKeyData = abi.encode(poolKey);
         bytes memory swapParamsData = abi.encode(swapParams);
         
         // Call the pool manager with proper calldata types
         (bool success, bytes memory result) = address(poolManager).call(
             abi.encodeWithSelector(
                 IPoolManager.swap.selector,
                 poolKey,
                 swapParams,
                 ""
             )
         );
         
         require(success, "Swap failed");
         delta = abi.decode(result, (BalanceDelta));
     }
}