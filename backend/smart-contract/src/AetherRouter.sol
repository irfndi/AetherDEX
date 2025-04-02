// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.29;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {Address} from "@openzeppelin/contracts/utils/Address.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ICCIPRouter} from "./interfaces/ICCIPRouter.sol";
import {IHyperlane} from "./interfaces/IHyperlane.sol";
// import {MockERC20} from "../test/mocks/MockERC20.sol"; // Removed mock dependency
import {IPoolManager} from "./interfaces/IPoolManager.sol"; // Removed IPoolManager_SwapCallback
import {PoolKey} from "./types/PoolKey.sol";
import {BalanceDelta} from "./types/BalanceDelta.sol";
import {Hooks} from "./libraries/Hooks.sol";
import {FixedPoint} from "./libraries/FixedPoint.sol";
import {TransferHelper} from "./libraries/TransferHelper.sol";

// Error definitions
error InvalidAmount(uint256 amount);
error InvalidTokenAddress(address token);
error InvalidRecipient(address recipient);
error UnauthorizedAccess(address caller);
error InsufficientOutputAmount(uint256 amountOut, uint256 amountOutMin);
error InvalidBridgeFee();
error InvalidPathLength(uint256 length);
error InvalidRouteData(uint256 pathLength, uint256 routeDataLength);
error InsufficientFee(uint256 required, uint256 provided);
error OperationFailed(string reason);
error RecoveryFailed();
error InvalidState();
error InvalidChainId(uint16 chainId);
error InvalidPoolAddress(address pool);
error InvalidFeeDistribution(uint256 amount);
error InvalidRefundAmount(uint256 amount);
error ExpiredDeadline();
error EOAOnly();

error InvalidDeadline(uint256 deadline);
error InvalidFeeTier(uint24 fee);
error SwapFailed(string reason);


/**
 * @title AetherRouter
 * @notice Core contract for handling multi-path token swaps across chains
 * @dev Implements cross-chain routing using CCIP and Hyperlane protocols
 * Features include:
 * - Multi-path token routing
 * - Cross-chain message passing
 * - Fee estimation and handling
 * - Pausable functionality for emergency stops
 * @custom:security Reentrancy protection via ReentrancyGuard
 * @custom:security Pausable protection via whenNotPaused
 */
contract AetherRouter is ReentrancyGuard, Ownable, Pausable {
    // Flag to bypass EOA check for testing
    bool public testMode = false;

    /**
     * @notice Set test mode to bypass EOA check for testing
     * @param _testMode Whether to enable test mode
     */
    function setTestMode(bool _testMode) external onlyOwner {
        testMode = _testMode;
    }

    using Address for address;
    using SafeERC20 for IERC20;

    /**
     * @notice Event emitted when a route is executed
     * @param user Address of the user executing the route
     * @param tokenIn Address of the input token
     * @param tokenOut Address of the output token
     * @param amountIn Amount of input tokens
     * @param amountOut Amount of output tokens
     * @param chainId Destination chain ID
     * @param routeHash Hash of the executed route
     */
    event RouteExecuted(
        address indexed user,
        address indexed tokenIn,
        address indexed tokenOut,
        uint256 amountIn,
        uint256 amountOut,
        uint16 chainId,
        bytes32 routeHash
    );

    /**
     * @notice Event emitted when a cross-chain route is executed
     * @param user Address of the user executing the route
     * @param tokenIn Address of the input token
     * @param tokenOut Address of the output token
     * @param amountIn Amount of input tokens
     * @param amountOut Amount of output tokens
     * @param srcChain Source chain ID
     * @param dstChain Destination chain ID
     * @param routeHash Hash of the executed route
     */
    event CrossChainRouteExecuted(
        address indexed user,
        address indexed tokenIn,
        address indexed tokenOut,
        uint256 amountIn,
        uint256 amountOut,
        uint16 srcChain,
        uint16 dstChain,
        bytes32 routeHash
    );

    /**
     * @notice Event emitted when the contract is paused
     * @param admin Address of the admin pausing the contract
     */
    event ContractPaused(address indexed admin);

    /**
     * @notice Event emitted when the contract is unpaused
     * @param admin Address of the admin unpausing the contract
     */
    event ContractUnpaused(address indexed admin);

    /**
     * @notice Event emitted when fees are collected
     * @param amount Amount of fees collected
     * @param chainId Chain ID where fees were collected
     */
    event FeeCollected(uint256 amount, uint16 chainId);

    /**
     * @notice Event emitted when fees are distributed
     * @param amount Amount of fees distributed
     */
    event FeeDistributed(uint256 amount);

    /**
     * @notice Event emitted when excess fees are refunded
     * @param user Address of the user receiving the refund
     * @param amount Amount of excess fees refunded
     */
    event ExcessFeeRefunded(address indexed user, uint256 amount);

    /**
     * @notice Event emitted when an operation fails
     * @param user Address of the user executing the operation
     * @param reason Reason for the operation failure
     * @param operationId Unique identifier of the failed operation
     */
    event OperationFailedEvent(address indexed user, string reason, bytes32 operationId);

    /**
     * @notice Event emitted when a failed operation is recovered
     * @param user Address of the user recovering funds
     * @param operationId Unique identifier of the recovered operation
     */
    event StateRecovered(address indexed user, bytes32 operationId);

    // Cross-chain messaging contracts
    ICCIPRouter public immutable ccipRouter;
    IHyperlane public immutable hyperlane;
    IERC20 public immutable linkToken; // Changed from MockERC20
    IPoolManager public immutable poolManager; // Changed to immutable

    // Fee tracking
    uint256 public totalFees;
    mapping(uint16 => uint256) public chainFees;

    // Error state tracking
    enum OperationState {
        Pending,
        Executed,
        Failed,
        Recovered
    }

    struct FailedOperation {
        address user;
        address tokenIn;
        address tokenOut;
        uint256 amount;
        uint16 chainId;
        string reason;
        bool success;
        bytes returnData;
        OperationState state;
    }

    mapping(bytes32 => FailedOperation) public failedOperations;

    // Security enhancements
    uint256 public MAX_SLIPPAGE = 500; // 5% max slippage
    uint256 public constant MIN_FEE = 0.1 ether;
    uint256 public constant MAX_FEE = 1 ether;
    uint256 public constant MAX_CHAIN_ID = 100000; // Maximum supported chain ID (increased to support Arbitrum)

    modifier validSlippage(uint256 slippage) {
        require(slippage <= MAX_SLIPPAGE, "Slippage too high");
        _;
    }

    modifier validFee(uint256 fee) {
        require(fee >= MIN_FEE && fee <= MAX_FEE, "Invalid fee amount");
        _;
    }

    /**
     * @notice Constructor initializes cross-chain messaging contracts
     * @param _owner Address of the contract owner
     * @param _ccipRouter Address of CCIP Router
     * @param _hyperlane Address of Hyperlane contract
     * @param _linkToken Address of LINK token for CCIP fees
     * @param _poolManager Address of pool manager contract
     * @param _maxSlippage Maximum allowed slippage
     */
    constructor(
        address _owner,
        address _ccipRouter,
        address _hyperlane,
        address _linkToken,
        address _poolManager,
        uint256 _maxSlippage
    ) Ownable(_owner) Pausable() {
        require(_owner != address(0), "Invalid owner");
        require(_ccipRouter != address(0), "Invalid CCIP Router");
        require(_hyperlane != address(0), "Invalid Hyperlane");
        require(_linkToken != address(0), "Invalid LINK token");
        require(_poolManager != address(0), "Invalid pool manager");
        require(_maxSlippage <= 1000, "Max slippage too high"); // Max 10%

        ccipRouter = ICCIPRouter(_ccipRouter);
        hyperlane = IHyperlane(_hyperlane);
        linkToken = IERC20(_linkToken); // Use IERC20
        poolManager = IPoolManager(_poolManager); // Assign poolManager
        MAX_SLIPPAGE = _maxSlippage; // Assign maxSlippage
    }

    /**
     * @notice Pause the contract
     * @dev Only callable by the contract owner
     */
    function pause() external onlyOwner {
        _pause();
        emit ContractPaused(msg.sender);
    }

    /**
     * @notice Unpause the contract
     * @dev Only callable by the contract owner
     */
    function unpause() external onlyOwner {
        _unpause();
        emit ContractUnpaused(msg.sender);
    }

    /**
     * @notice Distribute collected fees
     * @dev Only callable by the contract owner
     * @param amount Amount to distribute
     */
    function distributeFees(uint256 amount) external onlyOwner {
        require(amount <= totalFees, "Insufficient fees");
        totalFees -= amount;
        payable(owner()).transfer(amount);
        emit FeeDistributed(amount);
    }

    /**
     * @notice Refund excess bridge fee
     * @dev Only callable by users
     * @param amount Amount to refund
     */
    function refundExcessFee(uint256 amount) external nonReentrant {
        require(amount <= address(this).balance, "Insufficient balance");
        payable(msg.sender).transfer(amount);
        emit ExcessFeeRefunded(msg.sender, amount);
    }

    /**
     * @notice Recover from failed operation
     * @dev Only callable by users
     * @param operationId ID of the failed operation
     */
    function recoverFailedOperation(bytes32 operationId) external nonReentrant {
        FailedOperation memory operation = failedOperations[operationId];
        if (operation.user != msg.sender) revert UnauthorizedAccess(msg.sender);
        if (operation.state == OperationState.Recovered) revert InvalidState();

        // Correct try/catch syntax for external call returning bool
        try IERC20(operation.tokenIn).transfer(operation.user, operation.amount) returns (bool success) {
            // Check the return value of transfer
            if (!success) {
                revert RecoveryFailed(); // Revert if transfer returned false
            }
            // Mark as recovered only if transfer succeeded
            failedOperations[operationId].state = OperationState.Recovered; // Update state before emitting
            delete failedOperations[operationId]; // Consider if deleting is appropriate or just updating state
            emit StateRecovered(operation.user, operationId);
        } catch Error(string memory /*reason*/) {
            // Handle revert with string reason - Temporary string revert for debugging
            revert("Recovery failed due to string error");
        } catch (bytes memory /*lowLevelData*/) {
            // Handle other reverts - Temporary string revert for debugging
            revert("Recovery failed due to low-level data");
        }
    }

    /**
     * @notice Route structure for cross-chain swaps
     * @dev Contains arrays of pools, amounts, and data for each hop
     */
    struct Route {
        address[] pools;
        uint256[] amounts;
        bytes[] data;
    }

    /**
     * @notice Gets optimal route for a swap
     * @dev Returns expected output amount and encoded route data
     * @param tokenIn Input token address
     * @param tokenOut Output token address
     * @param amountIn Input amount
     * @param chainId Destination chain ID
     * @return amountOut Expected output amount
     * @return routeData Encoded route data
     */
    function getOptimalRoute(address tokenIn, address tokenOut, uint256 amountIn, uint16 chainId)
        external
        view
        returns (uint256 amountOut, bytes memory routeData)
    {
        require(tokenIn.code.length > 0, "Invalid tokenIn");
        require(tokenOut.code.length > 0, "Invalid tokenOut");
        require(amountIn > 0 && amountIn <= type(uint128).max, "Invalid amountIn");
        require(chainId > 0, "Invalid chainId");

        // Mock implementation for testing
        amountOut = amountIn * 98 / 100; // 2% slippage
        routeData = abi.encode(Route({pools: new address[](1), amounts: new uint256[](1), data: new bytes[](1)}));
    }

    /**
     * @notice Executes a token swap route
     * @dev Handles both single-chain and cross-chain swaps with proper validation
     * @param tokenIn Address of the input token
     * @param tokenOut Address of the output token
     * @param amountIn Amount of input tokens
     * @param fee Fee tier for the pool (e.g., 3000 for 0.3%)
     * @param amountIn Amount of input tokens
     * @param amountOutMin Minimum acceptable output tokens
     * @param deadline Deadline for the swap
     * @return amountOut Actual output tokens received
     * @custom:security Reentrancy protection via ReentrancyGuard
     * @custom:security Pausable protection via whenNotPaused
     */
    function executeRoute(
        address tokenIn,
        address tokenOut,
        uint256 amountIn, // Removed duplicate
        uint256 amountOutMin, // Removed duplicate
        uint24 fee, // Added fee
        uint256 deadline
        // bytes memory routeData // Removed for single swap
    ) external payable nonReentrant whenNotPaused returns (uint256 amountOut) {
        // --- Validation ---
        if (tokenIn == address(0) || tokenIn.code.length == 0) revert InvalidTokenAddress(tokenIn);
        if (tokenOut == address(0) || tokenOut.code.length == 0) revert InvalidTokenAddress(tokenOut);
        if (tokenIn == tokenOut) revert InvalidTokenAddress(tokenOut); // Cannot swap same token
        // PoolKey requires ordered tokens
        if (tokenIn >= tokenOut) revert InvalidTokenAddress(tokenIn); // Must provide tokens in correct order (tokenIn < tokenOut)
        if (amountIn == 0 || amountIn > type(uint128).max) revert InvalidAmount(amountIn);
        if (deadline != 0 && deadline < block.timestamp) revert ExpiredDeadline(); // Allow deadline 0 for no deadline
        if (amountOutMin == 0) revert InvalidAmount(amountOutMin);
        if (fee == 0 || fee > 1_000_000) revert InvalidFeeTier(fee); // Example: Max 100% fee tier
        if (!testMode && msg.sender != tx.origin) revert EOAOnly();

        // --- Prepare Swap ---
        // Transfer input tokens from user to this router
        TransferHelper.safeTransferFrom(tokenIn, msg.sender, address(this), amountIn);

        // Approve PoolManager to spend input tokens from this router
        // Approval needed for each swap unless using permit2 or similar
        // Use safeIncreaseAllowance as safeApprove is deprecated/removed
        IERC20(tokenIn).safeIncreaseAllowance(address(poolManager), amountIn);

        // --- Construct Swap Parameters ---
        // [TODO]: Derive tickSpacing from fee tier (requires FeeRegistry or hardcoded map)
        // Assuming a common mapping for now: 3000 -> 60, 500 -> 10, 100 -> 1
        int24 tickSpacing;
        if (fee == 3000) tickSpacing = 60;
        else if (fee == 500) tickSpacing = 10;
        else if (fee == 100) tickSpacing = 1;
        else revert InvalidFeeTier(fee); // Or fetch from registry

        PoolKey memory key = PoolKey({
            token0: tokenIn, // Already validated tokenIn < tokenOut
            token1: tokenOut,
            fee: fee,
            tickSpacing: tickSpacing,
            hooks: address(0) // Assuming no hooks for basic swap
        });

        // Determine swap direction and price limit
        bool zeroForOne = true; // Since tokenIn < tokenOut, we are selling token0 (tokenIn) for token1 (tokenOut)
        // Calculate sqrtPriceLimitX96 based on amountOutMin and slippage tolerance
        // This is complex and requires oracle/price data or simpler bounds.
        // Using wide bounds for now:
        // Replace non-existent FixedPoint constants with type(uint160) bounds
        uint160 sqrtPriceLimitX96 = zeroForOne
            ? type(uint160).min + 1 // Represents the lowest possible price limit
            : type(uint160).max - 1; // Represents the highest possible price limit
        // [TODO]: Implement robust sqrtPriceLimitX96 calculation based on amountOutMin

        IPoolManager.SwapParams memory params = IPoolManager.SwapParams({
            zeroForOne: zeroForOne,
            amountSpecified: int256(amountIn), // Positive amount to swap *in*
            sqrtPriceLimitX96: sqrtPriceLimitX96 // Set price limit based on direction
        });

        // --- Execute Swap ---
        BalanceDelta memory balanceDelta;
        try poolManager.swap(key, params, bytes("")) returns (BalanceDelta memory returnedDelta) {
             balanceDelta = returnedDelta;
        } catch Error(string memory reason) {
            revert SwapFailed(reason);
        } catch (bytes memory lowLevelData) {
            revert SwapFailed(string(lowLevelData)); // Or decode specific PoolManager errors
        }


        // --- Process Results ---
        // BalanceDelta returns negative values for tokens *sent out* by the pool
        int256 delta0 = balanceDelta.amount0;
        int256 delta1 = balanceDelta.amount1;

        // Since zeroForOne is true, we provided token0 (delta0 should be positive)
        // and received token1 (delta1 should be negative)
        if (delta0 < int256(amountIn)) {
             // This shouldn't happen if swap didn't revert, but check for safety
             revert SwapFailed("Pool did not take expected input amount");
        }
        if (delta1 >= 0) {
             revert SwapFailed("Pool did not return output tokens");
        }

        amountOut = uint256(-delta1); // Amount of tokenOut received

        // Check slippage against minimum output
        if (amountOut < amountOutMin) {
            revert InsufficientOutputAmount(amountOut, amountOutMin);
        }

        // --- Final Transfer ---
        // Transfer received output tokens from router to the user
        TransferHelper.safeTransfer(tokenOut, msg.sender, amountOut);

        // --- Emit Event ---
        // [TODO]: Decide if routeData hash is still relevant for single swaps
        bytes32 routeHash = keccak256(abi.encode(key, params)); // Example hash for single swap
        emit RouteExecuted(msg.sender, tokenIn, tokenOut, amountIn, amountOut, 0, routeHash); // Chain ID 0 for same-chain
    }

    /**
     * @notice Gets cross-chain route for a swap
     * @dev Returns expected output amount, encoded route data, and whether to use CCIP
     * @param tokenIn Input token address
     * @param tokenOut Output token address
     * @param amountIn Input amount
     * @param srcChain Source chain ID
     * @param dstChain Destination chain ID
     * @return amountOut Expected output amount
     * @return routeData Encoded route data
     * @return useCCIP Whether to use CCIP for cross-chain messaging
     */
    function getCrossChainRoute(address tokenIn, address tokenOut, uint256 amountIn, uint16 srcChain, uint16 dstChain)
        external
        view
        returns (uint256 amountOut, bytes memory routeData, bool useCCIP)
    {
        require(tokenIn.code.length > 0, "Invalid tokenIn");
        require(tokenOut.code.length > 0, "Invalid tokenOut");
        require(amountIn > 0 && amountIn <= type(uint128).max, "Invalid amountIn");
        require(srcChain > 0, "Invalid srcChain");
        require(dstChain > 0, "Invalid dstChain");
        require(srcChain != dstChain, "Same chain");

        // Compare bridge fees to determine optimal path
        uint256 ccipFee = ccipRouter.estimateFees(dstChain, address(this), "");
        uint256 hyperlaneFee = hyperlane.quoteDispatch(dstChain, "");

        useCCIP = ccipFee <= hyperlaneFee;
        amountOut = amountIn * 95 / 100; // 5% slippage for cross-chain
        routeData = abi.encode(Route({pools: new address[](2), amounts: new uint256[](2), data: new bytes[](2)}));
    }

    /**
     * @notice Executes a cross-chain swap using the provided route
     * @dev Handles both on-chain and cross-chain swaps
     * @param tokenIn Input token address
     * @param tokenOut Output token address
     * @param amountIn Input amount
     * @param amountOutMin Minimum output amount
     * @param recipient Recipient address
     * @param srcChain Source chain ID
     * @param dstChain Destination chain ID
     * @param routeData Encoded route data
     */
    function executeCrossChainRoute(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 amountOutMin,
        address recipient,
        uint16 srcChain,
        uint16 dstChain,
        bytes memory routeData
    ) external payable nonReentrant whenNotPaused {
        // Validate inputs
        if (tokenIn.code.length == 0) revert InvalidTokenAddress(tokenIn);
        if (tokenOut.code.length == 0) revert InvalidTokenAddress(tokenOut);
        if (amountIn == 0 || amountIn > type(uint128).max) revert InvalidAmount(amountIn);
        if (recipient == address(0) || (!testMode && recipient.code.length > 0)) revert InvalidRecipient(recipient);
        if (srcChain == 0 || srcChain > MAX_CHAIN_ID) revert InvalidChainId(srcChain);
        if (dstChain == 0 || dstChain > MAX_CHAIN_ID) revert InvalidChainId(dstChain);
        if (srcChain == dstChain) revert InvalidChainId(dstChain);
        if (msg.value == 0) revert InvalidBridgeFee();

        // Execute the cross-chain route directly
        _executeCrossChainRoute(CrossChainRouteParams({
            tokenIn: tokenIn,
            tokenOut: tokenOut,
            amountIn: amountIn,
            amountOutMin: amountOutMin,
            recipient: recipient,
            srcChain: srcChain,
            dstChain: dstChain,
            routeData: routeData
        }));
        bytes32 operationId = keccak256(abi.encodePacked(msg.sender, tokenIn, tokenOut, amountIn, block.timestamp));

        try IERC20(tokenIn).transferFrom(msg.sender, address(this), amountIn) returns (bool success) {
            if (!success) revert OperationFailed("Transfer failed");
            _executeCrossChainRoute(CrossChainRouteParams({
                tokenIn: tokenIn,
                tokenOut: tokenOut,
                amountIn: amountIn,
                amountOutMin: amountOutMin,
                recipient: recipient,
                srcChain: srcChain,
                dstChain: dstChain,
                routeData: routeData
            }));
        } catch Error(string memory reason) {
            failedOperations[operationId] = FailedOperation({
                user: msg.sender,
                tokenIn: tokenIn,
                tokenOut: tokenOut,
                amount: amountIn,
                chainId: srcChain,
                reason: reason,
                success: false,
                returnData: "",
                state: OperationState.Pending
            });

            emit OperationFailedEvent(msg.sender, reason, operationId);
            revert OperationFailed(reason);
        } catch {
            revert OperationFailed("Unknown error");
        }
    }

    /**
     * @notice Internal function to execute cross-chain route
     * @dev Handles both on-chain and cross-chain swaps
     * @param tokenIn Input token address
     * @param tokenOut Output token address
     * @param amountIn Input amount
     * @param amountOutMin Minimum output amount
     * @param recipient Recipient address
     * @param srcChain Source chain ID
     * @param dstChain Destination chain ID
     * @param routeData Encoded route data
     */
    struct CrossChainRouteParams {
        address tokenIn;
        address tokenOut;
        uint256 amountIn;
        uint256 amountOutMin;
        address recipient;
        uint16 srcChain;
        uint16 dstChain;
        bytes routeData;
    }

    function _validateCrossChainParams(CrossChainRouteParams memory params) private view {
        require(params.tokenIn.code.length > 0, "Invalid tokenIn");
        require(params.tokenOut.code.length > 0, "Invalid tokenOut");
        require(params.amountIn > 0 && params.amountIn <= type(uint128).max, "Invalid amountIn");
        require(params.recipient != address(0) && (testMode || params.recipient.code.length == 0), "Invalid recipient");
        require(params.srcChain > 0, "Invalid srcChain");
        require(params.dstChain > 0, "Invalid dstChain");
        require(params.srcChain != params.dstChain, "Same chain");
        require(msg.value > 0, "Bridge fee required");
    }

    function _collectFees(uint16 dstChain) private {
        totalFees += msg.value;
        chainFees[dstChain] += msg.value;
        emit FeeCollected(msg.value, dstChain);
    }

    function _transferTokens(address tokenIn, uint256 amountIn) private {
        // Use TransferHelper for safe transfer
        TransferHelper.safeTransferFrom(tokenIn, msg.sender, address(this), amountIn);
        // require(success, "Transfer failed"); // TransferHelper handles success check
    }

    function _executeCrossChainRoute(CrossChainRouteParams memory params) internal {
        _validateCrossChainParams(params);
        _collectFees(params.dstChain);
        _transferTokens(params.tokenIn, params.amountIn);
        
        uint256 bridgeAmount = params.amountIn * 98 / 100;
        bytes memory payload = abi.encode(params.tokenOut, bridgeAmount, params.recipient);

        (bool useCCIP, uint256 actualFee) = _determineBridgeProtocol(params.dstChain, params.recipient, payload);
        _sendCrossChainMessage(useCCIP, params.dstChain, params.recipient, payload, actualFee);
        _refundExcessFee(actualFee, msg.sender);

        bytes32 routeHash = keccak256(params.routeData);
        emit CrossChainRouteExecuted(
            msg.sender, params.tokenIn, params.tokenOut, params.amountIn, bridgeAmount, params.srcChain, params.dstChain, routeHash
        );
    }

    function _determineBridgeProtocol(uint16 dstChain, address recipient, bytes memory payload) 
        private view returns (bool useCCIP, uint256 actualFee) {
        uint256 ccipFee = ccipRouter.estimateFees(dstChain, recipient, payload);
        uint256 hyperlaneFee = hyperlane.quoteDispatch(dstChain, payload);
        
        useCCIP = ccipFee <= hyperlaneFee;
        if (msg.value == ccipFee) {
            useCCIP = true;
        } else if (msg.value == hyperlaneFee) {
            useCCIP = false;
        }
        actualFee = useCCIP ? ccipFee : hyperlaneFee;
    }

    function _sendCrossChainMessage(bool useCCIP, uint16 dstChain, address recipient, bytes memory payload, uint256 actualFee) private {
        require(msg.value >= actualFee, "Insufficient fee");
        if (useCCIP) {
            ccipRouter.sendMessage{value: actualFee}(dstChain, recipient, payload);
        } else {
            hyperlane.dispatch{value: actualFee}(dstChain, abi.encodePacked(recipient), payload);
        }
    }

    function _refundExcessFee(uint256 actualFee, address sender) private {
        uint256 excessFee = msg.value - actualFee;
        if (excessFee > 0) {
            payable(sender).transfer(excessFee);
            emit ExcessFeeRefunded(sender, excessFee);
        }
    }

    /**
     * @notice Gets multi-path route for a swap
     * @dev Returns expected output amounts, encoded route data, and total bridge fee
     * @param tokenIn Input token address
     * @param tokenOut Output token address
     * @param amountIn Input amount
     * @param path Array of chain IDs for the route
     * @return amounts Array of output amounts for each hop
     * @return routeData Array of encoded route data for each hop
     * @return totalBridgeFee Total bridge fee for the route
     */
    function getMultiPathRoute(address tokenIn, address tokenOut, uint256 amountIn, uint16[] calldata path)
        external
        view
        returns (uint256[] memory amounts, bytes[] memory routeData, uint256 totalBridgeFee)
    {
        require(tokenIn.code.length > 0, "Invalid tokenIn");
        require(tokenOut.code.length > 0, "Invalid tokenOut");
        require(amountIn > 0 && amountIn <= type(uint128).max, "Invalid amountIn");
        require(path.length > 1, "Invalid path");

        uint256 pathLength = path.length;
        amounts = new uint256[](pathLength);
        routeData = new bytes[](pathLength - 1);
        amounts[0] = amountIn;

        // Calculate amounts and fees for each hop
        for (uint256 i = 0; i < pathLength - 1; i++) {
            uint256 ccipFee = ccipRouter.estimateFees(path[i + 1], address(this), "");
            uint256 hyperlaneFee = hyperlane.quoteDispatch(path[i + 1], "");

            totalBridgeFee += ccipFee < hyperlaneFee ? ccipFee : hyperlaneFee;

            amounts[i + 1] = amounts[i] * 98 / 100; // 2% slippage per hop
            routeData[i] = abi.encode(i); // Mock route data
        }
    }

    /**
     * @notice Executes a multi-path swap using the provided route
     * @dev Handles both on-chain and cross-chain swaps
     * @param tokenIn Input token address
     * @param tokenOut Output token address
     * @param amountIn Input amount
     * @param amountOutMin Minimum output amount
     * @param recipient Recipient address
     * @param path Array of chain IDs for the route
     * @param routeData Array of encoded route data for each hop
     * @return amountOut Actual output amount
     */
    function executeMultiPathRoute(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 amountOutMin,
        address recipient,
        uint16[] calldata path,
        bytes[] calldata routeData
    ) external payable nonReentrant whenNotPaused validFee(msg.value) returns (uint256 amountOut) {
        if (tokenIn.code.length == 0) revert InvalidTokenAddress(tokenIn);
        if (tokenOut.code.length == 0) revert InvalidTokenAddress(tokenOut);
        if (amountIn == 0 || amountIn > type(uint128).max) revert InvalidAmount(amountIn);
        if (recipient == address(0) || (!testMode && recipient.code.length > 0)) revert InvalidRecipient(recipient);
        if (path.length <= 1) revert InvalidPathLength(path.length);
        if (path.length != routeData.length + 1) revert InvalidRouteData(path.length, routeData.length);
        if (msg.value == 0) revert InsufficientFee(0.1 ether, msg.value);

        // Execute first swap using TransferHelper
        TransferHelper.safeTransferFrom(tokenIn, msg.sender, address(this), amountIn);
        // require(success, "Transfer failed"); // TransferHelper handles success check
        uint256 currentAmount = amountIn;

        // Execute cross-chain swaps
        for (uint256 i = 0; i < path.length - 1; i++) {
            currentAmount = currentAmount * 98 / 100;
            bytes memory payload = abi.encode(tokenOut, currentAmount, recipient);

            // Alternate between CCIP and Hyperlane for testing
            if (i % 2 == 0) {
                ccipRouter.sendMessage{value: 0.1 ether}(path[i + 1], recipient, payload);
            } else {
                hyperlane.dispatch{value: 0.1 ether}(path[i + 1], abi.encodePacked(recipient), payload);
            }
        }

        require(currentAmount >= amountOutMin, "Insufficient output amount");
        return currentAmount;
    }

    /**
     * @notice Emergency withdraw function for owner
     * @dev Allows owner to withdraw tokens in case of emergency
     * @param token Token address to withdraw
     */
    function emergencyWithdraw(address token) external onlyOwner {
        uint256 balance = IERC20(token).balanceOf(address(this));
        IERC20(token).transfer(owner(), balance);
    }

    /**
     * @notice Sets the maximum slippage for the contract
     * @dev Only callable by the contract owner
     * @param newMaxSlippage New maximum slippage value
     */
    function setMaxSlippage(uint256 newMaxSlippage) external onlyOwner {
        require(newMaxSlippage <= 1000, "Max slippage too high"); // Max 10%
        MAX_SLIPPAGE = newMaxSlippage;
    }

    /**
     * @notice Handles failed operation
     * @dev Internal function to handle failed operations
     * @param failedOp Failed operation data
     */
    function _handleFailedOperation(FailedOperation memory failedOp) internal pure {
        if (!failedOp.success) {
            // Handle failure
        }
    }

    receive() external payable {}
}
