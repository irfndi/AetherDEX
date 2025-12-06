// SPDX-License-Identifier: GPL-3.0

/*
Created by irfndi (github.com/irfndi) - Apr 2025
Email: join.mantap@gmail.com
*/

pragma solidity ^0.8.29;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {Address} from "@openzeppelin/contracts/utils/Address.sol";
import {ICCIPRouter} from "../interfaces/ICCIPRouter.sol";
import {IHyperlane} from "../interfaces/IHyperlane.sol";
import {IAetherPool} from "../interfaces/IAetherPool.sol";
import {IPoolManager} from "../interfaces/IPoolManager.sol";
import {AetherFactory} from "./AetherFactory.sol";
import {PoolKey} from "../../lib/v4-core/src/types/PoolKey.sol";
import {Currency} from "v4-core/types/Currency.sol";
import {IHooks} from "v4-core/interfaces/IHooks.sol";
import {BalanceDelta} from "../types/BalanceDelta.sol";
import {Hooks} from "../libraries/Hooks.sol";
import {Errors} from "../libraries/Errors.sol";
import {FixedPoint} from "../libraries/FixedPoint.sol";
import {TickMath} from "v4-core/libraries/TickMath.sol";
import {BaseRouter} from "./BaseRouter.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Errors} from "../libraries/Errors.sol";

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
 * @title AetherRouterCrossChain
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
contract AetherRouterCrossChain is BaseRouter, Ownable, Pausable {
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
    AetherFactory public immutable factory;

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
    uint256 public maxSlippage = 300;
    uint256 public constant MIN_FEE = 0.1 ether;
    uint256 public constant MAX_FEE = 1 ether;
    uint256 public constant MAX_CHAIN_ID = 100_000;

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
        address initialOwner,
        address _ccipRouter,
        address _hyperlane,
        address _linkToken,
        address _poolManager,
        address _factory,
        uint256 _maxSlippage
    ) Ownable(initialOwner) Pausable() {
        if (initialOwner == address(0)) revert Errors.ZeroAddress();
        if (_ccipRouter == address(0)) revert Errors.ZeroAddress();
        if (_hyperlane == address(0)) revert Errors.ZeroAddress();
        if (_linkToken == address(0)) revert Errors.ZeroAddress();
        if (_poolManager == address(0)) revert Errors.ZeroAddress();
        if (_factory == address(0)) revert Errors.ZeroAddress();
        if (_maxSlippage > 1000) revert Errors.ExcessiveSlippage();

        ccipRouter = ICCIPRouter(_ccipRouter);
        hyperlane = IHyperlane(_hyperlane);
        linkToken = IERC20(_linkToken);
        poolManager = IPoolManager(_poolManager);
        factory = AetherFactory(_factory);
        maxSlippage = _maxSlippage;
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
        require(amount <= totalFees, "Insufficient fees");
        totalFees -= amount;

        (bool success,) = payable(owner()).call{value: amount}("");
        require(success, "FEE_DISTRIBUTE_FAILED");

        emit FeeDistributed(amount);
    }

    /**
     * @notice Refund excess bridge fee
     * @dev Only callable by users
     * @param amount Amount to refund
     */
    function refundExcessFee(uint256 amount) external nonReentrant {
        require(amount > 0, "Invalid refund amount");
        require(amount <= address(this).balance, "Insufficient contract balance");

        emit ExcessFeeRefunded(msg.sender, amount);

        _refundExcessFee(amount, msg.sender);
    }

    /**
     * @notice Recover from failed operation
     * @dev Only callable by users
     * @param operationId ID of the failed operation
     */
    function recoverFailedOperation(bytes32 operationId) external nonReentrant {
        FailedOperation storage operation = failedOperations[operationId];
        if (operation.user != msg.sender) revert UnauthorizedAccess(msg.sender);
        if (operation.state == OperationState.Recovered) revert InvalidState();

        IERC20(operation.tokenIn).safeTransfer(operation.user, operation.amount);

        operation.state = OperationState.Recovered;
        emit StateRecovered(operation.user, operationId);
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

        amountOut = amountIn * 98 / 100;
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
        _validateExecuteRouteInput(tokenIn, tokenOut, amountIn, amountOutMin, fee, deadline);

        PoolKey memory key = _prepareSwap(tokenIn, tokenOut, fee);

        (BalanceDelta memory balanceDelta, bool zeroForOne) = _executePoolSwap(key, tokenIn, amountIn);

        amountOut = _processSwapOutput(key, amountOutMin, balanceDelta, zeroForOne);

        emit RouteExecuted(msg.sender, tokenIn, tokenOut, amountIn, amountOut, 0, bytes32(0));
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
        if (tokenIn == address(0) || tokenIn.code.length == 0) {
            revert InvalidTokenAddress(tokenIn);
        }
        if (tokenOut == address(0) || tokenOut.code.length == 0) revert InvalidTokenAddress(tokenOut);
        if (tokenIn == tokenOut) revert InvalidTokenAddress(tokenOut);
        if (tokenIn >= tokenOut) revert InvalidTokenAddress(tokenIn);
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
    function _prepareSwap(address tokenIn, address tokenOut, uint24 fee) internal pure returns (PoolKey memory key) {
        address _token0 = tokenIn < tokenOut ? tokenIn : tokenOut;
        address _token1 = tokenIn < tokenOut ? tokenOut : tokenIn;

        key = PoolKey({
            currency0: Currency.wrap(_token0),
            currency1: Currency.wrap(_token1),
            fee: fee,
            tickSpacing: 0,
            hooks: IHooks(address(0))
        });
    }

    /**
     * @notice Internal function to execute the swap via the PoolManager
     * @param key The PoolKey for the swap
     * @param tokenIn The actual input token address (needed to determine swap direction)
     * @param amountIn The amount of tokenIn being swapped
     * @return balanceDelta The result of the swap
     * @return zeroForOne The calculated swap direction (true if swapping token0 for token1)
     */
    function _executePoolSwap(PoolKey memory key, address tokenIn, uint256 amountIn)
        internal
        returns (BalanceDelta memory balanceDelta, bool zeroForOne)
    {
        zeroForOne = tokenIn == Currency.unwrap(key.currency0);

        address poolAddress = poolManager.getPool(key);
        if (poolAddress == address(0)) revert Errors.InvalidPath(); // Using InvalidPath for pool not found

        _transferToPool(tokenIn, poolAddress, amountIn);

        uint256 amountOut = _swap(poolAddress, amountIn, tokenIn, address(this), 0);
        int256 amount0Delta;
        int256 amount1Delta;
        if (zeroForOne) {
            amount0Delta = -int256(amountIn);
            amount1Delta = int256(amountOut);
        } else {
            amount1Delta = -int256(amountIn);
            amount0Delta = int256(amountOut);
        }
        balanceDelta = BalanceDelta(amount0Delta, amount1Delta);
    }

    /**
     * @notice Internal function to process the swap output: check results, check slippage, transfer tokens out
     * @param key The PoolKey for the swap
     * @param amountOutMin The minimum acceptable output amount
     * @param balanceDelta The result from the PoolManager swap
     * @param zeroForOne The actual swap direction
     * @return amountOut The final output amount
     */
    function _processSwapOutput(
        PoolKey memory key,
        uint256 amountOutMin,
        BalanceDelta memory balanceDelta,
        bool zeroForOne
    ) internal returns (uint256 amountOut) {
        if (zeroForOne) {
            if (balanceDelta.amount0 >= 0) {
                revert SwapFailed("z4o: Router delta shows no token0 sent");
            }
            if (balanceDelta.amount1 <= 0) revert SwapFailed("z4o: Router delta shows no token1 received");
            amountOut = uint256(balanceDelta.amount1);
        } else {
            if (balanceDelta.amount1 >= 0) revert SwapFailed("o4z: Router delta shows no token1 sent");
            if (balanceDelta.amount0 <= 0) revert SwapFailed("o4z: Router delta shows no token0 received");
            amountOut = uint256(balanceDelta.amount0);
        }

        if (amountOut < amountOutMin) {
            revert InsufficientOutputAmount(amountOut, amountOutMin);
        }

        address tokenOutAddress = zeroForOne ? Currency.unwrap(key.currency1) : Currency.unwrap(key.currency0);
        if (IERC20(tokenOutAddress).balanceOf(address(this)) < amountOut) {
            revert Errors.InsufficientLiquidity(); // Using InsufficientLiquidity for insufficient output token balance
        }
        IERC20(tokenOutAddress).safeTransfer(msg.sender, amountOut);
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
        if (srcChain == 0) revert Errors.InvalidSrcChain();
        if (dstChain == 0) revert Errors.InvalidDstChain();
        if (srcChain == dstChain) revert Errors.InvalidDstChain(); // Using InvalidDstChain for same chain error

        uint256 ccipFee = ccipRouter.estimateFees(dstChain, address(this), "");
        uint256 hyperlaneFee = hyperlane.quoteDispatch(dstChain, "");

        useCCIP = ccipFee <= hyperlaneFee;
        amountOut = amountIn * 95 / 100;
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
        if (tokenIn.code.length == 0) revert InvalidTokenAddress(tokenIn);
        if (tokenOut.code.length == 0) revert InvalidTokenAddress(tokenOut);
        if (amountIn == 0 || amountIn > type(uint128).max) revert InvalidAmount(amountIn);
        if (recipient == address(0) || (!testMode && recipient.code.length > 0)) revert InvalidRecipient(recipient);
        if (srcChain == 0 || srcChain > MAX_CHAIN_ID) revert InvalidChainId(srcChain);
        if (dstChain == 0 || dstChain > MAX_CHAIN_ID) revert InvalidChainId(dstChain);
        if (srcChain == dstChain) revert InvalidChainId(dstChain);
        if (msg.value == 0) revert InvalidBridgeFee();

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

    function _executeCrossChainRoute(CrossChainRouteParams memory params) internal {
        _validateCrossChainParams(params);
        _collectFees(params.dstChain);

        IERC20(params.tokenIn).safeTransferFrom(msg.sender, address(this), params.amountIn);

        uint256 bridgeAmount = params.amountOutMin;
        bytes memory payload = abi.encode(params.tokenOut, bridgeAmount, params.recipient);

        (bool useCCIP, uint256 actualFee) = _determineBridgeProtocol(params.dstChain, params.recipient, payload);

        if (useCCIP) {
            _safeApprove(params.tokenIn, address(ccipRouter), params.amountIn);
        } else {
            _safeApprove(params.tokenIn, address(hyperlane), params.amountIn);
        }

        bytes32 routeHash = keccak256(
            abi.encodePacked(params.tokenIn, params.tokenOut, params.amountIn, params.srcChain, params.dstChain)
        );
        emit CrossChainRouteExecuted(
            msg.sender,
            params.tokenIn,
            params.tokenOut,
            params.amountIn,
            bridgeAmount,
            params.srcChain,
            params.dstChain,
            routeHash
        );

        _sendCrossChainMessage(useCCIP, params.dstChain, params.recipient, payload, actualFee);

        uint256 refundAmount = msg.value >= actualFee ? msg.value - actualFee : 0;
        _refundExcessFee(refundAmount, msg.sender);
    }

    function _determineBridgeProtocol(uint16 dstChain, address recipient, bytes memory payload)
        private
        view
        returns (bool useCCIP, uint256 actualFee)
    {
        uint256 estimatedCcipFee = ccipRouter.estimateFees(dstChain, recipient, payload);
        uint256 estimatedHyperlaneFee = hyperlane.quoteDispatch(dstChain, "");

        if (msg.value >= estimatedHyperlaneFee && msg.value < estimatedCcipFee) {
            // If the fee is closer to Hyperlane fee or between Hyperlane and CCIP, use Hyperlane
            useCCIP = false;
            actualFee = estimatedHyperlaneFee;
        } else if (msg.value >= estimatedCcipFee) {
            // If the fee is equal to or greater than CCIP fee, use CCIP
            useCCIP = true;
            actualFee = estimatedCcipFee;
        } else {
            if (estimatedCcipFee <= estimatedHyperlaneFee) {
                useCCIP = true;
                actualFee = estimatedCcipFee;
            } else {
                useCCIP = false;
                actualFee = estimatedHyperlaneFee;
            }
        }
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
                require(messageId != bytes32(0), "CCIP sendMessage failed: Invalid message ID");
            } catch Error(string memory reason) {
                revert OperationFailed(reason);
            } catch (bytes memory lowLevelData) {
                revert OperationFailed(string(lowLevelData));
            }
        } else {
            try hyperlane.dispatch{value: actualFee}(dstChain, abi.encodePacked(recipient), payload) returns (
                bytes32 messageId
            ) {
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

        for (uint256 i = 0; i < pathLength - 1; i++) {
            uint256 ccipFee = ccipRouter.estimateFees(path[i + 1], address(this), "");
            uint256 hyperlaneFee = hyperlane.quoteDispatch(path[i + 1], "");

            totalBridgeFee += ccipFee < hyperlaneFee ? ccipFee : hyperlaneFee;

            amounts[i + 1] = amounts[i] * 98 / 100;
            routeData[i] = abi.encode(i);
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
        _validateMultiPathParams(tokenIn, tokenOut, amountIn, recipient, path, routeData);

        IERC20(tokenIn).safeTransferFrom(msg.sender, address(this), amountIn);
        uint256 currentAmount = amountIn;

        for (uint256 i = 0; i < path.length - 1; i++) {
            currentAmount = currentAmount * 98 / 100;
            currentAmount = _executeBridgeHop(tokenIn, tokenOut, currentAmount, recipient, path[i + 1], i % 2 == 0);
        }

        require(currentAmount >= amountOutMin, "Insufficient output amount");
        return currentAmount;
    }

    function _validateMultiPathParams(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        address recipient,
        uint16[] calldata path,
        bytes[] calldata routeData
    ) private view {
        if (tokenIn.code.length == 0) revert InvalidTokenAddress(tokenIn);
        if (tokenOut.code.length == 0) revert InvalidTokenAddress(tokenOut);
        if (amountIn == 0 || amountIn > type(uint128).max) revert InvalidAmount(amountIn);
        if (recipient == address(0) || (!testMode && recipient.code.length > 0)) revert InvalidRecipient(recipient);
        if (path.length <= 1) revert InvalidPathLength(path.length);
        if (path.length != routeData.length + 1) revert InvalidRouteData(path.length, routeData.length);
        if (msg.value == 0) revert InsufficientFee(0.1 ether, msg.value);
    }

    function _executeBridgeHop(
        address tokenIn,
        address tokenOut,
        uint256 amount,
        address recipient,
        uint16 dstChain,
        bool useCCIP
    ) private returns (uint256) {
        bytes memory payload = abi.encode(tokenOut, amount, recipient);

        if (useCCIP) {
            _safeApprove(tokenIn, address(ccipRouter), amount);
            require(ccipRouter.depositToken(tokenIn, amount), "CCIP token deposit failed");

            bytes32 messageId = ccipRouter.sendMessage{value: 0.1 ether}(dstChain, recipient, payload);
            require(messageId != bytes32(0), "CCIP sendMessage failed in multi-path");
        } else {
            _safeApprove(tokenIn, address(hyperlane), amount);
            require(hyperlane.depositToken(tokenIn, amount), "Hyperlane token deposit failed");

            bytes32 messageId = hyperlane.dispatch{value: 0.1 ether}(dstChain, abi.encodePacked(recipient), payload);
            require(messageId != bytes32(0), "Hyperlane dispatch failed in multi-path");
        }

        return amount;
    }

    /**
     * @notice Emergency withdraw function for owner
     * @dev Allows owner to withdraw tokens in case of emergency
     * @param token Token address to withdraw
     */
    function emergencyWithdraw(address token) external onlyOwner nonReentrant {
        uint256 balance = IERC20(token).balanceOf(address(this));
        IERC20(token).safeTransfer(owner(), balance);
    }

    /**
     * @notice Sets the maximum slippage for the contract
     * @dev Only callable by the contract owner
     * @param newMaxSlippage New maximum slippage value
     */
    function setMaxSlippage(uint256 newMaxSlippage) external onlyOwner {
        require(newMaxSlippage <= 1000, "Max slippage too high");
        maxSlippage = newMaxSlippage;
    }

    receive() external payable {}

    function _refundExcessFee(uint256 excessFee, address recipient) internal {
        if (excessFee > 0) {
            (bool success,) = recipient.call{value: excessFee}("");
            require(success, "AetherRouter: Fee refund failed");
        }
    }

    function _safeApprove(address token, address spender, uint256 value) internal {
        // Reset approval to 0 first for tokens that require it (like USDT)
        try IERC20(token).approve(spender, 0) {}
        catch {
            revert Errors.ApprovalFailed();
        }

        // Then set the approval to the desired value
        bool success = IERC20(token).approve(spender, value);
        if (!success) revert Errors.ApprovalFailed();
    }
}
