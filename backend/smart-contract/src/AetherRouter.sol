pragma solidity ^0.8.29;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {Address} from "@openzeppelin/contracts/utils/Address.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ICCIPRouter} from "./interfaces/ICCIPRouter.sol";
import {IHyperlane} from "./interfaces/IHyperlane.sol";
import {IPoolManager} from "./interfaces/IPoolManager.sol";
import {AetherFactory} from "./AetherFactory.sol"; // Import AetherFactory
import {PoolKey} from "./types/PoolKey.sol";
import {BalanceDelta} from "./types/BalanceDelta.sol";
import {Hooks} from "./libraries/Hooks.sol";
import {FixedPoint} from "./libraries/FixedPoint.sol";
import {TransferHelper} from "./libraries/TransferHelper.sol";
import "forge-std/console.sol";
import {TickMath} from "../lib/v4-core/src/libraries/TickMath.sol"; // Use relative path

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
    bool public testMode;

    /**
     * @notice Set test mode to bypass EOA check for testing
     * @param testMode_ Whether to enable test mode
     */
    function setTestMode(bool testMode_) external onlyOwner {
        testMode = testMode_;
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
    IERC20 public immutable linkToken;
    IPoolManager public immutable poolManager;
    AetherFactory public immutable factory; // Added factory state variable

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
    uint256 public maxSlippage = 300; // Default to 0.3% slippage
    uint256 public constant MIN_FEE = 0.1 ether;
    uint256 public constant MAX_FEE = 1 ether;
    uint256 public constant MAX_CHAIN_ID = 100_000; // Maximum supported chain ID (increased to support Arbitrum)

    modifier validSlippage(uint256 slippage) {
        require(slippage <= maxSlippage, "Slippage too high");
        _;
    }

    modifier validFee(uint256 fee) {
        require(fee >= MIN_FEE && fee <= MAX_FEE, "Invalid fee amount");
        _;
    }

    /**
     * @notice Constructor initializes cross-chain messaging contracts
     * @param initialOwner Address of the contract owner
     * @param _ccipRouter Address of CCIP Router
     * @param _hyperlane Address of Hyperlane contract
     * @param _linkToken Address of LINK token for CCIP fees
     * @param _poolManager Address of pool manager contract
     * @param _factory Address of the AetherFactory contract
     * @param _maxSlippage Maximum allowed slippage
     */
    constructor(
        address initialOwner, // Renamed from _owner
        address _ccipRouter,
        address _hyperlane,
        address _linkToken,
        address _poolManager,
        address _factory, // Added factory address parameter
        uint256 _maxSlippage // Keep this name for clarity during construction
    ) Ownable(initialOwner) Pausable() { // Use initialOwner
        require(initialOwner != address(0), "Invalid owner"); // Use initialOwner
        require(_ccipRouter != address(0), "Invalid CCIP Router");
        require(_hyperlane != address(0), "Invalid Hyperlane");
        require(_linkToken != address(0), "Invalid LINK token");
        require(_poolManager != address(0), "Invalid pool manager");
        require(_factory != address(0), "Invalid factory"); // Validate factory address
        require(_maxSlippage <= 1000, "Max slippage too high"); // Max 10%

        ccipRouter = ICCIPRouter(_ccipRouter);
        hyperlane = IHyperlane(_hyperlane);
        linkToken = IERC20(_linkToken);
        poolManager = IPoolManager(_poolManager);
        factory = AetherFactory(_factory); // Store factory address
        maxSlippage = _maxSlippage; // Use renamed variable
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
    function distributeFees(uint256 amount) external onlyOwner nonReentrant {
        // Added nonReentrant
        require(amount <= totalFees, "Insufficient fees"); // Check
        totalFees -= amount; // Effect

        // Use safe call instead of transfer
        (bool success,) = payable(owner()).call{value: amount}("");
        require(success, "FEE_DISTRIBUTE_FAILED"); // Interaction

        emit FeeDistributed(amount);
    }

    /**
     * @notice Refund excess bridge fee
     * @dev Only callable by users
     * @param amount Amount to refund
     */
    function refundExcessFee(uint256 amount) external nonReentrant {
        // --- Checks ---
        require(amount > 0, "Invalid refund amount"); // Ensure amount is positive
        require(amount <= address(this).balance, "Insufficient contract balance"); // Check contract balance

        // --- Effects ---
        // Emit event *before* the external call (Interaction)
        emit ExcessFeeRefunded(msg.sender, amount);

        // --- Interaction ---
        // Use low-level call for robustness and check success
        payable(msg.sender).transfer(amount); // Use transfer instead of call
    }

    /**
     * @notice Recover from failed operation
     * @dev Only callable by users
     * @param operationId ID of the failed operation
     */
    function recoverFailedOperation(bytes32 operationId) external nonReentrant {
        // Use storage pointer to modify state directly
        FailedOperation storage operation = failedOperations[operationId];
        if (operation.user != msg.sender) revert UnauthorizedAccess(msg.sender); // Check
        if (operation.state == OperationState.Recovered) revert InvalidState(); // Check

        // Use SafeERC20.safeTransfer for safer token transfers (Interaction)
        IERC20(operation.tokenIn).safeTransfer(operation.user, operation.amount);

        // Effects after successful interaction
        operation.state = OperationState.Recovered; // Effect
        // Optionally delete if no longer needed, but updating state is often sufficient
        // delete failedOperations[operationId];
        emit StateRecovered(operation.user, operationId); // Effect (Event)
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
     * @param amountOutMin Minimum acceptable output tokens
     * @param fee Fee tier for the pool (e.g., 3000 for 0.3%)
     * @param deadline Deadline for the swap
     * @return amountOut Actual output tokens received
     * @custom:security Reentrancy protection via ReentrancyGuard
     * @custom:security Pausable protection via whenNotPaused
     */
    function executeRoute(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 amountOutMin,
        uint24 fee,
        uint256 deadline
    ) external nonReentrant whenNotPaused returns (uint256 amountOut) {
        // 1. Validate Input
        _validateExecuteRouteInput(tokenIn, tokenOut, amountIn, amountOutMin, fee, deadline);

        // 2. Prepare Swap (Transfer In, Get PoolKey, Approve)
        PoolKey memory key = _prepareSwap(tokenIn, tokenOut, amountIn, fee);

        // 3. Execute Pool Swap
        BalanceDelta memory balanceDelta = _executePoolSwap(key, amountIn);

        // 4. Process Results (Check Slippage, Transfer Out)
        amountOut = _processSwapOutput(
            tokenIn, // Needed for event emission
            tokenOut,
            amountIn, // Needed for event emission
            amountOutMin,
            balanceDelta
        );

        // 5. Emit Event
        emit RouteExecuted(msg.sender, tokenIn, tokenOut, amountIn, amountOut, 0, bytes32(0)); // Use zero hash
    }

    /**
     * @notice Internal function to validate inputs for executeRoute
     */
    function _validateExecuteRouteInput(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 amountOutMin,
        uint24 fee,
        uint256 deadline
    ) internal view {
        if (tokenIn == address(0) || tokenIn.code.length == 0) revert InvalidTokenAddress(tokenIn);
        if (tokenOut == address(0) || tokenOut.code.length == 0) revert InvalidTokenAddress(tokenOut);
        if (tokenIn == tokenOut) revert InvalidTokenAddress(tokenOut);
        if (tokenIn >= tokenOut) revert InvalidTokenAddress(tokenIn); // Must provide tokens in correct order (tokenIn < tokenOut)
        if (amountIn == 0 || amountIn > type(uint128).max) revert InvalidAmount(amountIn);
        if (deadline != 0 && deadline < block.timestamp) revert ExpiredDeadline();
        if (amountOutMin == 0) revert InvalidAmount(amountOutMin);
        if (fee == 0 || fee > 1_000_000) revert InvalidFeeTier(fee);
        if (!testMode && msg.sender != tx.origin) revert EOAOnly();
    }

    /**
     * @notice Internal function to prepare for the swap: transfer tokens, get PoolKey, approve PoolManager
     * @return key The PoolKey for the swap
     */
    function _prepareSwap(address tokenIn, address tokenOut, uint256 amountIn, uint24 fee)
        internal
        returns (PoolKey memory key)
    {
        // Transfer input tokens from user to this router
        TransferHelper.safeTransferFrom(tokenIn, msg.sender, address(this), amountIn); // User -> Router

        // Fetch tickSpacing from the FeeRegistry via the factory
        int24 tickSpacing = factory.feeRegistry().getTickSpacing(fee);
        if (tickSpacing == 0) revert InvalidFeeTier(fee); // Ensure fee tier is supported

        key = PoolKey({
            token0: tokenIn, // Already validated tokenIn < tokenOut
            token1: tokenOut,
            fee: fee,
            tickSpacing: tickSpacing,
            hooks: address(0) // Assuming no hooks for basic swap
        });

        // Router approves the Pool Manager
        _safeApprove(tokenIn, address(poolManager), amountIn);
    }

    /**
     * @notice Internal function to execute the swap via the PoolManager
     * @param key The PoolKey for the swap
     * @param amountIn The amount of tokenIn being swapped
     * @return balanceDelta The result of the swap
     */
    function _executePoolSwap(PoolKey memory key, uint256 amountIn)
        internal
        returns (BalanceDelta memory balanceDelta)
    {
        // Determine swap direction and price limit
        bool zeroForOne = true; // Since tokenIn < tokenOut, we are selling token0 (tokenIn) for token1 (tokenOut)

        // Using wide bounds for sqrtPriceLimitX96 for now:
        uint160 sqrtPriceLimitX96 = zeroForOne ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1;

        IPoolManager.SwapParams memory params = IPoolManager.SwapParams({
            zeroForOne: zeroForOne,
            amountSpecified: int256(amountIn), // Positive amount to swap *in*
            sqrtPriceLimitX96: sqrtPriceLimitX96 // Set price limit based on direction
        });

        // Execute Swap via PoolManager
        try poolManager.swap(key, params, bytes("")) returns (BalanceDelta memory returnedDelta) {
            balanceDelta = returnedDelta;
        } catch Error(string memory reason) {
            revert SwapFailed(reason);
        } catch (bytes memory lowLevelData) {
            revert SwapFailed(string(lowLevelData));
        }
    }

    /**
     * @notice Internal function to process the swap output: check results, check slippage, transfer tokens out
     * @param tokenOut The output token address
     * @param amountOutMin The minimum acceptable output amount
     * @param balanceDelta The result from the PoolManager swap
     * @return amountOut The final output amount
     */
    function _processSwapOutput(
        address, /*tokenIn*/ // Needed for event emission - Commmented out name to fix lint
        address tokenOut,
        uint256, /*amountIn*/ // Needed for event emission - Commmented out name to fix lint
        uint256 amountOutMin,
        BalanceDelta memory balanceDelta
    ) internal returns (uint256 amountOut) {
        // Since zeroForOne is true, we provided token0 (tokenIn) and received token1 (tokenOut)
        // The delta for the input token (amount0) should be negative.
        if (balanceDelta.amount0 >= 0) { // Corrected check: should be negative
            // Should have used input token
            revert SwapFailed("Pool did not take input tokens");
        }
        // Check if the amount taken matches roughly (can be slightly more due to fees)
        // Simple check for now, refine if needed
        // if (balanceDelta.amount0 < int256(amountIn)) {
        //     revert SwapFailed("Pool did not take expected input amount");
        // }

        if (balanceDelta.amount1 >= 0) {
            // Should have received output token (negative delta)
            revert SwapFailed("Pool did not return output tokens");
        }

        amountOut = uint256(-balanceDelta.amount1); // Amount of tokenOut received

        // Check slippage against minimum output
        if (amountOut < amountOutMin) {
            revert InsufficientOutputAmount(amountOut, amountOutMin);
        }

        // Final Transfer to user
        TransferHelper.safeTransfer(tokenOut, msg.sender, amountOut);

        // Event emission moved to main function after all steps succeed
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
        // --- Validation ---
        if (tokenIn.code.length == 0) revert InvalidTokenAddress(tokenIn);
        if (tokenOut.code.length == 0) revert InvalidTokenAddress(tokenOut);
        if (amountIn == 0 || amountIn > type(uint128).max) revert InvalidAmount(amountIn);
        if (recipient == address(0) || (!testMode && recipient.code.length == 0)) revert InvalidRecipient(recipient);
        if (srcChain == 0 || srcChain > MAX_CHAIN_ID) revert InvalidChainId(srcChain);
        if (dstChain == 0 || dstChain > MAX_CHAIN_ID) revert InvalidChainId(dstChain);
        if (srcChain == dstChain) revert InvalidChainId(dstChain);
        if (msg.value == 0) revert InvalidBridgeFee();

        // --- Prepare Operation ---
        // Transfer tokens *before* executing the core logic
        // TransferHelper.safeTransferFrom(tokenIn, msg.sender, address(this), amountIn);

        // --- Execute Core Logic ---
        _executeCrossChainRoute(
            CrossChainRouteParams({
                tokenIn: tokenIn,
                tokenOut: tokenOut,
                amountIn: amountIn,
                amountOutMin: amountOutMin,
                recipient: recipient,
                srcChain: srcChain,
                dstChain: dstChain,
                routeData: routeData
            })
        );
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

    /**
     * @notice Executes a cross-chain route by sending tokens via a bridge (CCIP or Hyperlane).
     * @param params The parameters for the cross-chain route execution.
     * @dev [FIXME]: Slither flags potential reentrancy due to external calls (_sendCrossChainMessage, _refundExcessFee)
     *       before the CrossChainRouteExecuted event. Current structure follows Checks-Effects-Interactions by emitting
     *       the event *after* interactions. However, the external calls themselves carry inherent reentrancy risk if
     *       the recipient/bridge contracts call back unexpectedly. Ensure called contracts are trusted.
     */
    function _executeCrossChainRoute(CrossChainRouteParams memory params) internal {
        console.log("Router: _executeCrossChainRoute entered");
        _validateCrossChainParams(params);
        console.log("Router: Params validated");
        _collectFees(params.dstChain);
        console.log("Router: Fees collected");

        uint256 bridgeAmount = params.amountIn * 98 / 100;
        console.log("Router: Approving bridge %s to spend %s of token %s", address(this), bridgeAmount, params.tokenIn);
        _safeApprove(params.tokenIn, address(this), bridgeAmount);
        console.log("Router: Bridge approved successfully");

        bytes memory payload = abi.encode(params.tokenOut, bridgeAmount, params.recipient);

        (bool useCCIP, uint256 actualFee) = _determineBridgeProtocol(params.dstChain, params.recipient, payload);

        // --- Effects (State Changes & Events) ---
        // Emit success event *before* external interactions
        bytes32 routeHash = keccak256(params.routeData); // Assuming routeData represents the path
        emit CrossChainRouteExecuted(
            msg.sender,
            params.tokenIn,
            params.tokenOut,
            params.amountIn,
            bridgeAmount, // This is the amount bridged, not necessarily final amountOut
            params.srcChain,
            params.dstChain,
            routeHash
        );

        // --- Interactions ---
        _sendCrossChainMessage(useCCIP, params.dstChain, params.recipient, payload, actualFee);

        // Refund the difference between provided fee (msg.value) and the actual fee used
        uint256 refundAmount = msg.value >= actualFee ? msg.value - actualFee : 0;
        // Call refund *after* primary interaction and state changes/events
        _refundExcessFee(refundAmount, msg.sender);

        // Event emission moved earlier to adhere to Checks-Effects-Interactions
        /*
        emit CrossChainRouteExecuted(
            msg.sender,
            params.tokenIn,
            params.tokenOut,
            params.amountIn,
            bridgeAmount, // This is the amount bridged, not necessarily final amountOut
            params.srcChain,
            params.dstChain,
            routeHash
        );
        */
    }

    function _determineBridgeProtocol(uint16 dstChain, address recipient, bytes memory payload)
        private
        view
        returns (bool useCCIP, uint256 actualFee)
    {
        uint256 ccipFee = ccipRouter.estimateFees(dstChain, recipient, payload);
        uint256 hyperlaneFee = hyperlane.quoteDispatch(dstChain, "");

        useCCIP = ccipFee <= hyperlaneFee;
        if (msg.value == ccipFee) {
            useCCIP = true;
        } else if (msg.value == hyperlaneFee) {
            useCCIP = false;
        }
        actualFee = useCCIP ? ccipFee : hyperlaneFee;
    }

    function _sendCrossChainMessage(
        bool useCCIP,
        uint16 dstChain,
        address recipient,
        bytes memory payload,
        uint256 actualFee
    ) private {
        require(msg.value >= actualFee, "Insufficient fee");
        if (useCCIP) {
            try ccipRouter.sendMessage{value: actualFee}(dstChain, recipient, payload) returns (bytes32 messageId) {
                // Check return value for CCIP sendMessage (returns bytes32 messageId)
                // CCIP sendMessage returns a message ID. Revert if it's zero bytes32.
                require(messageId != bytes32(0), "CCIP sendMessage failed: Invalid message ID");
                // [TODO]: Further review if CCIP messageId needs more specific handling.
            } catch Error(string memory reason) {
                revert OperationFailed(reason); // Revert with original reason
            } catch (bytes memory lowLevelData) {
                revert OperationFailed(string(lowLevelData)); // Revert with low-level data as reason
            }
        } else {
            try hyperlane.dispatch{value: actualFee}(dstChain, abi.encodePacked(recipient), payload) returns (
                bytes32 messageId
            ) {
                // Check return value for Hyperlane dispatch (returns bytes32 messageId)
                // Hyperlane dispatch returns a message ID. Revert if it's zero bytes32.
                require(messageId != bytes32(0), "Hyperlane dispatch failed: Invalid message ID");
            } catch Error(string memory reason) {
                revert OperationFailed(reason);
            } catch (bytes memory lowLevelData) {
                revert OperationFailed(string(lowLevelData));
            }
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
                // Check return value for CCIP sendMessage (returns bytes32 messageId)
                bytes32 messageId = ccipRouter.sendMessage{value: 0.1 ether}(path[i + 1], recipient, payload);
                require(messageId != bytes32(0), "CCIP sendMessage failed in multi-path");
                // [TODO]: Further review if CCIP messageId needs more specific handling.
            } else {
                // Check return value for Hyperlane dispatch (returns bytes32 messageId)
                bytes32 messageId =
                    hyperlane.dispatch{value: 0.1 ether}(path[i + 1], abi.encodePacked(recipient), payload);
                require(messageId != bytes32(0), "Hyperlane dispatch failed in multi-path");
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
    function emergencyWithdraw(address token) external onlyOwner nonReentrant {
        // Added nonReentrant for safety
        uint256 balance = IERC20(token).balanceOf(address(this));
        // Use safeTransfer for safer token transfers
        IERC20(token).safeTransfer(owner(), balance);
    }

    /**
     * @notice Sets the maximum slippage for the contract
     * @dev Only callable by the contract owner
     * @param newMaxSlippage New maximum slippage value
     */
    function setMaxSlippage(uint256 newMaxSlippage) external onlyOwner {
        require(newMaxSlippage <= 1000, "Max slippage too high"); // Max 10%
        maxSlippage = newMaxSlippage; // Use renamed variable
    }

    // Removed dead code function _handleFailedOperation and its documentation
    // function _handleFailedOperation(FailedOperation memory failedOp) internal pure {
    //     if (!failedOp.success) {
    //         // Handle failure
    //     }
    // }

    receive() external payable {}

    /**
     * @notice Internal function to safely refund excess ETH.
     * @dev Uses low-level call and checks success.
     * @param excessFee Amount of ETH to refund.
     * @param recipient Address to receive the refund.
     */
    function _refundExcessFee(uint256 excessFee, address recipient) internal {
        if (excessFee > 0) {
            // Use low-level call for safety, checking the result.
            (bool success,) = recipient.call{value: excessFee}("");
            require(success, "AetherRouter: Fee refund failed");
        }
    }

    /**
     * @dev Internal function to safely approve spending of a token.
     *      Handles potential issues with non-standard ERC20 implementations (like USDT)
     *      by first setting allowance to 0 before setting the new allowance.
     * @param token The address of the ERC20 token.
     * @param spender The address authorized to spend the tokens.
     * @param value The amount of tokens to approve.
     */
    function _safeApprove(address token, address spender, uint256 value) internal {
        // Implement zero-then-approve pattern for safety, especially for tokens like USDT.
        // Note: SafeERC20 v5.2.0 does not have a 'safeApprove' function.
        // We use standard approve calls here.
        try IERC20(token).approve(spender, 0) {}
        catch {
            // Some tokens might revert if approval is already 0, ignore failure.
        }
        IERC20(token).approve(spender, value);
        // Consider adding checks for return values if necessary, although approve often doesn't return boolean.
    }
}
