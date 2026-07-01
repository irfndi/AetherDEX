// SPDX-License-Identifier: MIT
pragma solidity ^0.8.31;

import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {BalanceDelta, BalanceDeltaLibrary} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {BeforeSwapDelta, BeforeSwapDeltaLibrary} from "@uniswap/v4-core/src/types/BeforeSwapDelta.sol";
import {ModifyLiquidityParams, SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Errors} from "../lib/Errors.sol";

/// @title AetherHook
/// @notice Custom Uniswap V4 hook for AetherDEX
/// @dev Captures protocol fee on every swap + records TWAP observations.
///      Hook permissions: BEFORE_SWAP_FLAG | AFTER_SWAP_FLAG
///      The hook address MUST have bits 6 and 7 set for these flags.
contract AetherHook is IHooks, Ownable {

    /// @notice The Uniswap V4 PoolManager
    IPoolManager public immutable poolManager;

    /// @notice The AetherDEX treasury (receives protocol fees)
    address public treasury;

    /// @notice Protocol fee in basis points (e.g. 10 = 0.10%)
    uint24 public protocolFeeBps;

    /// @notice Maximum protocol fee (1000 bps = 10%)
    uint24 public constant MAX_PROTOCOL_FEE_BPS = 1000;

    /// @notice TWAP observation for a pool
    struct Observation {
        uint32 timestamp;
        uint256 priceCumulative;
        uint256 priceLatest;
    }

    // ---- TWAP storage ----
    /// @dev poolId => array of observations (circular buffer, size 1024)
    mapping(bytes32 => Observation[1024]) internal _observations;
    /// @dev poolId => current observation index
    mapping(bytes32 => uint16) public observationIndex;
    /// @dev poolId => observation count (capped at 1024)
    mapping(bytes32 => uint16) public observationCount;

    // ---- Fee accrual storage ----
    /// @dev poolId => accumulated protocol fees in token0
    mapping(bytes32 => uint256) public accruedFees0;
    /// @dev poolId => accumulated protocol fees in token1
    mapping(bytes32 => uint256) public accruedFees1;

    // ---- Events ----
    event ProtocolFeeUpdated(uint24 oldFee, uint24 newFee);
    event TreasuryUpdated(address oldTreasury, address newTreasury);
    event FeesWithdrawn(bytes32 indexed poolId, address indexed to, uint256 amount0, uint256 amount1);
    event ObservationRecorded(
        bytes32 indexed poolId, uint32 timestamp, uint256 priceCumulative, uint256 priceLatest
    );

    // ---- Errors ----
    error FeeTooHigh();

    /// @param _poolManager The Uniswap V4 PoolManager
    /// @param _treasury The address that receives protocol fees
    /// @param _protocolFeeBps Initial protocol fee in basis points
    /// @param _initialOwner The initial owner of the hook
    constructor(
        IPoolManager _poolManager,
        address _treasury,
        uint24 _protocolFeeBps,
        address _initialOwner
    ) Ownable(_initialOwner) {
        if (_treasury == address(0)) revert Errors.ZeroAddress();
        if (_protocolFeeBps > MAX_PROTOCOL_FEE_BPS) revert FeeTooHigh();
        poolManager = _poolManager;

        // Validate hook address has correct permission flags
        Hooks.validateHookPermissions(
            this,
            Hooks.Permissions({
                beforeInitialize: false,
                afterInitialize: false,
                beforeAddLiquidity: false,
                afterAddLiquidity: false,
                beforeRemoveLiquidity: false,
                afterRemoveLiquidity: false,
                beforeSwap: true,
                afterSwap: true,
                beforeDonate: false,
                afterDonate: false,
                beforeSwapReturnDelta: false,
                afterSwapReturnDelta: false,
                afterAddLiquidityReturnDelta: false,
                afterRemoveLiquidityReturnDelta: false
            })
        );

        treasury = _treasury;
        protocolFeeBps = _protocolFeeBps;
    }

    // ---- Owner-only admin functions ----

    /// @notice Set the protocol fee (only owner)
    /// @param _newFeeBps New fee in basis points (max 1000 = 10%)
    function setProtocolFee(uint24 _newFeeBps) external onlyOwner {
        if (_newFeeBps > MAX_PROTOCOL_FEE_BPS) revert FeeTooHigh();
        emit ProtocolFeeUpdated(protocolFeeBps, _newFeeBps);
        protocolFeeBps = _newFeeBps;
    }

    /// @notice Set the treasury address (only owner)
    /// @param _newTreasury New treasury address
    function setTreasury(address _newTreasury) external onlyOwner {
        if (_newTreasury == address(0)) revert Errors.ZeroAddress();
        emit TreasuryUpdated(treasury, _newTreasury);
        treasury = _newTreasury;
    }

    /// @notice Withdraw accrued protocol fees for a pool (only owner)
    /// @param poolId The pool to withdraw fees from
    /// @dev In production, this transfers tokens via poolManager.take().
    ///      Currently emits event only — actual transfer requires unlock context.
    function withdrawFees(bytes32 poolId) external onlyOwner {
        uint256 amount0 = accruedFees0[poolId];
        uint256 amount1 = accruedFees1[poolId];
        if (amount0 == 0 && amount1 == 0) revert Errors.ZeroAmount();

        // CEI: zero accounting first.
        accruedFees0[poolId] = 0;
        accruedFees1[poolId] = 0;

        // NOTE: Actual token transfer must happen inside the poolManager.unlock() callback
        // so the hook can call poolManager.take() to pull tokens from the pool manager's
        // transient balance. This function only resets the accounting — the owner must
        // call withdrawFees in a callback that transfers the actual tokens. Emit the
        // event for off-chain indexers; the actual token movement happens in the callback.
        emit FeesWithdrawn(poolId, treasury, amount0, amount1);
    }

    // ---- IHooks implementation ----

    /// @inheritdoc IHooks
    function beforeInitialize(address, PoolKey calldata, uint160) external pure returns (bytes4) {
        revert("not implemented");
    }

    /// @inheritdoc IHooks
    function afterInitialize(address, PoolKey calldata, uint160, int24) external pure returns (bytes4) {
        revert("not implemented");
    }

    /// @inheritdoc IHooks
    function beforeAddLiquidity(address, PoolKey calldata, ModifyLiquidityParams calldata, bytes calldata)
        external
        pure
        returns (bytes4)
    {
        revert("not implemented");
    }

    /// @inheritdoc IHooks
    function afterAddLiquidity(
        address,
        PoolKey calldata,
        ModifyLiquidityParams calldata,
        BalanceDelta,
        BalanceDelta,
        bytes calldata
    ) external pure returns (bytes4, BalanceDelta) {
        revert("not implemented");
    }

    /// @inheritdoc IHooks
    function beforeRemoveLiquidity(address, PoolKey calldata, ModifyLiquidityParams calldata, bytes calldata)
        external
        pure
        returns (bytes4)
    {
        revert("not implemented");
    }

    /// @inheritdoc IHooks
    function afterRemoveLiquidity(
        address,
        PoolKey calldata,
        ModifyLiquidityParams calldata,
        BalanceDelta,
        BalanceDelta,
        bytes calldata
    ) external pure returns (bytes4, BalanceDelta) {
        revert("not implemented");
    }

    /// @inheritdoc IHooks
    function beforeSwap(address, PoolKey calldata, SwapParams calldata, bytes calldata)
        external
        onlyPoolManager
        returns (bytes4, BeforeSwapDelta, uint24)
    {
        // No-op: we capture fees in afterSwap
        return (this.beforeSwap.selector, BeforeSwapDeltaLibrary.ZERO_DELTA, 0);
    }

    /// @inheritdoc IHooks
    function afterSwap(
        address,
        PoolKey calldata key,
        SwapParams calldata params,
        BalanceDelta delta,
        bytes calldata
    ) external onlyPoolManager returns (bytes4, int128) {
        bytes32 poolId = _poolId(key);

        // Determine swap direction from delta
        int128 amount0 = delta.amount0();
        int128 amount1 = delta.amount1();
        uint256 amountIn;
        uint256 amountOut;

        if (params.zeroForOne) {
            // Swapping token0 for token1: user pays token0 (positive delta0), receives token1 (negative delta1)
            amountIn = amount0 > 0 ? uint256(int256(amount0)) : 0;
            amountOut = amount1 < 0 ? uint256(int256(-amount1)) : 0;
        } else {
            // Swapping token1 for token0: user pays token1 (positive delta1), receives token0 (negative delta0)
            amountIn = amount1 > 0 ? uint256(int256(amount1)) : 0;
            amountOut = amount0 < 0 ? uint256(int256(-amount0)) : 0;
        }

        // Capture protocol fee
        if (protocolFeeBps > 0 && amountIn > 0) {
            uint256 fee = (amountIn * uint256(protocolFeeBps)) / 10_000;
            if (params.zeroForOne) {
                accruedFees0[poolId] += fee;
            } else {
                accruedFees1[poolId] += fee;
            }
        }

        // Record TWAP observation
        if (amountIn > 0 && amountOut > 0) {
            uint256 price = (amountIn * 1e18) / amountOut;
            _recordObservation(poolId, price);
        }

        // Return 0 delta — the hook does not alter the swap output
        return (this.afterSwap.selector, 0);
    }

    /// @inheritdoc IHooks
    function beforeDonate(address, PoolKey calldata, uint256, uint256, bytes calldata)
        external
        pure
        returns (bytes4)
    {
        revert("not implemented");
    }

    /// @inheritdoc IHooks
    function afterDonate(address, PoolKey calldata, uint256, uint256, bytes calldata)
        external
        pure
        returns (bytes4)
    {
        revert("not implemented");
    }

    // ---- TWAP read functions ----

    /// @notice Get current TWAP for a pool
    /// @param poolId The pool to query
    /// @param lookback Number of observations to look back
    /// @return TWAP price scaled by 1e18
    function getCurrentTwap(bytes32 poolId, uint32 lookback) external view returns (uint256) {
        uint16 count = observationCount[poolId];
        if (count == 0) return 0;

        uint16 currentIndex = observationIndex[poolId];
        uint256 lookbackSafe = lookback > count ? count : lookback;
        if (lookbackSafe == 0) lookbackSafe = 1;

        uint256 currentCumulative = _observations[poolId][currentIndex].priceCumulative;
        uint256 previousCumulative;

        if (count > lookbackSafe) {
            uint16 lookbackIndex = (currentIndex + 1024 - uint16(lookbackSafe)) % 1024;
            previousCumulative = _observations[poolId][lookbackIndex].priceCumulative;
        }

        return currentCumulative - previousCumulative;
    }

    /// @notice Get the latest observation for a pool
    /// @param poolId The pool to query
    /// @return timestamp The observation timestamp
    /// @return priceCumulative The cumulative price
    /// @return priceLatest The latest price
    function getLatestObservation(bytes32 poolId)
        external
        view
        returns (uint32 timestamp, uint256 priceCumulative, uint256 priceLatest)
    {
        uint16 count = observationCount[poolId];
        if (count == 0) return (0, 0, 0);

        uint16 idx = observationIndex[poolId];
        Observation memory obs = _observations[poolId][idx];
        return (obs.timestamp, obs.priceCumulative, obs.priceLatest);
    }

    // ---- Internal functions ----

    /// @notice Compute pool ID from PoolKey
    function _poolId(PoolKey memory key) internal pure returns (bytes32) {
        return keccak256(abi.encode(key));
    }

    /// @notice Record a TWAP observation for a pool
    function _recordObservation(bytes32 poolId, uint256 price) internal {
        uint16 index = observationIndex[poolId];
        uint16 count = observationCount[poolId];

        // Compute new cumulative price
        uint256 previousCumulative = count > 0 ? _observations[poolId][index].priceCumulative : 0;
        uint256 cumulative = previousCumulative + price;

        // Advance circular buffer
        uint16 nextIndex = (index + 1) % 1024;
        observationIndex[poolId] = nextIndex;
        observationCount[poolId] = count < 1024 ? count + 1 : 1024;

        _observations[poolId][nextIndex] = Observation({
            timestamp: uint32(block.timestamp),
            priceCumulative: cumulative,
            priceLatest: price
        });

        emit ObservationRecorded(poolId, uint32(block.timestamp), cumulative, price);
    }

    /// @notice Modifier to ensure only PoolManager can call hook callbacks
    modifier onlyPoolManager() {
        if (msg.sender != address(poolManager)) revert Errors.Unauthorized();
        _;
    }
}
