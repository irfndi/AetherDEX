// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "../interfaces/IPoolManager.sol";
import "../../lib/v4-core/src/types/PoolKey.sol";
import "../types/BalanceDelta.sol";
import "../libraries/Errors.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "../access/RoleManager.sol";
import "../interfaces/IAetherPool.sol";
// import "./AetherPool.sol"; // REMOVED: Hybrid architecture uses Vyper pool or Factory
import {Currency} from "v4-core/types/Currency.sol";

// Use structs from IPoolManager interface

/**
 * @title PoolManager
 * @notice Manages pool creation, lifecycle, operations
 * @dev Implements the IPoolManager interface with access control
 */
contract PoolManager is IPoolManager, AccessControl {
    /// @notice Role manager for access control
    RoleManager public immutable roleManager;

    // Events are defined in IPoolManager interface

    /// @notice Mapping from pool key hash to pool address
    mapping(bytes32 => address) private _pools;

    /// @notice Mapping from pool key hash to pool information
    mapping(bytes32 => PoolInfo) private _poolInfo;

    /// @notice Array of all pool addresses
    address[] private _allPools;

    /// @notice Mapping from token pair to pool addresses
    mapping(bytes32 => address[]) private _poolsByTokenPair;

    /// @notice Pool implementation contract for CREATE2 deployment
    address public poolImplementation;

    /// @notice Minimum tick spacing allowed
    int24 public constant MIN_TICK_SPACING = 1;

    /// @notice Maximum tick spacing allowed
    int24 public constant MAX_TICK_SPACING = 16384;

    /// @notice Maximum fee allowed (10% in hundredths of a bip)
    uint24 public constant MAX_FEE = 1000000;

    /// @notice Pool information structure
    struct PoolInfo {
        address pool;
        bool paused;
        uint256 createdAt;
        uint24 fee;
        int24 tickSpacing;
        address hooks;
    }

    /// @notice Modifier to check if caller has admin role
    modifier onlyAdmin() {
        if (!roleManager.hasRole(roleManager.ADMIN_ROLE(), msg.sender)) {
            revert Errors.NotOwner();
        }
        _;
    }

    /// @notice Modifier to check if caller has operator role
    modifier onlyOperator() {
        if (!roleManager.hasRole(roleManager.OPERATOR_ROLE(), msg.sender)) {
            revert Errors.NotOwner();
        }
        _;
    }

    /**
     * @notice Constructor
     * @param _roleManager Address of the role manager contract
     * @param _poolImplementation Address of the pool implementation contract
     */
    constructor(address _roleManager, address _poolImplementation) {
        if (_roleManager == address(0) || _poolImplementation == address(0)) {
            revert Errors.ZeroAddress();
        }
        roleManager = RoleManager(_roleManager);
        poolImplementation = _poolImplementation;
    }

    /**
     * @inheritdoc IPoolManager
     */
    function createPool(PoolKey calldata key) external override onlyAdmin returns (address pool) {
        // Validate pool key
        if (!validatePoolKey(key)) {
            revert Errors.InvalidPoolKey();
        }

        bytes32 keyHash = _getPoolKeyHash(key);

        // Check if pool already exists
        if (_pools[keyHash] != address(0)) {
            revert Errors.PoolAlreadyExists();
        }

        // REMOVED: Hybrid architecture uses AetherFactory or Vyper pools.
        // This function is kept for interface compliance but implementation is disabled
        // to prevent dependency on missing Solidity pool contract.
        // If PoolManager logic is required, it should be updated to call AetherFactory
        // or deploy Vyper bytecode directly (which requires bytecode to be available).

        revert("PoolManager: USE_AETHER_FACTORY");

        /*
        // Create pool using CREATE2 for deterministic address
        bytes32 salt = keyHash;
        // ... Code removed ...
        */
    }

    /**
     * @inheritdoc IPoolManager
     */
    function getPool(PoolKey calldata key) external view override returns (address pool) {
        bytes32 keyHash = _getPoolKeyHash(key);
        return _pools[keyHash];
    }

    /**
     * @inheritdoc IPoolManager
     */
    function poolExists(PoolKey calldata key) external view override returns (bool exists) {
        bytes32 keyHash = _getPoolKeyHash(key);
        return _pools[keyHash] != address(0);
    }

    /**
     * @inheritdoc IPoolManager
     */
    function getAllPools() external view override returns (address[] memory pools) {
        return _allPools;
    }

    /**
     * @inheritdoc IPoolManager
     */
    function getPoolCount() external view override returns (uint256 count) {
        return _allPools.length;
    }

    /**
     * @inheritdoc IPoolManager
     */
    function setPoolPauseStatus(PoolKey calldata key, bool paused) external override onlyAdmin {
        bytes32 keyHash = _getPoolKeyHash(key);
        if (_pools[keyHash] == address(0)) {
            revert Errors.PoolNotFound();
        }

        _poolInfo[keyHash].paused = paused;
        emit PoolPauseStatusChanged(key, paused);
    }

    /**
     * @inheritdoc IPoolManager
     */
    function updatePoolHooks(PoolKey calldata key, address newHooks) external override onlyAdmin {
        bytes32 keyHash = _getPoolKeyHash(key);
        if (_pools[keyHash] == address(0)) {
            revert Errors.PoolNotFound();
        }

        _poolInfo[keyHash].hooks = newHooks;
        emit PoolHooksUpdated(key, newHooks);
    }

    /**
     * @inheritdoc IPoolManager
     */
    function updatePoolParameters(PoolKey calldata key, uint24 newFee, int24 newTickSpacing)
        external
        override
        onlyAdmin
    {
        bytes32 keyHash = _getPoolKeyHash(key);
        if (_pools[keyHash] == address(0)) {
            revert Errors.PoolNotFound();
        }

        if (newFee > MAX_FEE) {
            revert Errors.InvalidFee();
        }

        if (newTickSpacing < MIN_TICK_SPACING || newTickSpacing > MAX_TICK_SPACING) {
            revert Errors.InvalidTickSpacing();
        }

        _poolInfo[keyHash].fee = newFee;
        _poolInfo[keyHash].tickSpacing = newTickSpacing;

        emit PoolParametersUpdated(key, newFee, newTickSpacing);
    }

    /**
     * @inheritdoc IPoolManager
     */
    function isPoolPaused(PoolKey calldata key) external view override returns (bool paused) {
        bytes32 keyHash = _getPoolKeyHash(key);
        return _poolInfo[keyHash].paused;
    }

    /**
     * @inheritdoc IPoolManager
     */
    function getPoolInfo(PoolKey calldata key)
        external
        view
        override
        returns (address pool, bool paused, uint256 createdAt)
    {
        bytes32 keyHash = _getPoolKeyHash(key);
        PoolInfo memory info = _poolInfo[keyHash];
        return (info.pool, info.paused, info.createdAt);
    }

    /**
     * @inheritdoc IPoolManager
     */
    function validatePoolKey(PoolKey calldata key) public pure override returns (bool valid) {
        // Check for zero addresses
        if (key.currency0.isAddressZero() || key.currency1.isAddressZero()) {
            return false;
        }

        // Ensure currency0 < currency1 for consistent ordering
        if (key.currency0 >= key.currency1) {
            return false;
        }

        // Validate fee
        if (key.fee > MAX_FEE) {
            return false;
        }

        // Validate tick spacing
        if (key.tickSpacing < MIN_TICK_SPACING || key.tickSpacing > MAX_TICK_SPACING) {
            return false;
        }

        return true;
    }

    /**
     * @inheritdoc IPoolManager
     */
    function migratePool(PoolKey calldata key, address newImplementation) external override onlyAdmin {
        bytes32 keyHash = _getPoolKeyHash(key);
        address currentPool = _pools[keyHash];

        if (currentPool == address(0)) {
            revert Errors.PoolNotFound();
        }

        if (newImplementation == address(0)) {
            revert Errors.ZeroAddress();
        }

        // This is a placeholder for pool migration logic
        // In a real implementation, this would involve:
        // 1. Pausing the current pool
        // 2. Migrating liquidity and state
        // 3. Updating the pool address
        // 4. Resuming operations on the new pool

        // For now, we just update the pool address
        _pools[keyHash] = newImplementation;
        _poolInfo[keyHash].pool = newImplementation;
    }

    /**
     * @inheritdoc IPoolManager
     */
    function getPoolsByTokenPair(address token0, address token1)
        external
        view
        override
        returns (address[] memory pools)
    {
        // Ensure consistent token ordering
        if (token0 > token1) {
            (token0, token1) = (token1, token0);
        }

        bytes32 tokenPairHash = _getTokenPairHash(token0, token1);
        return _poolsByTokenPair[tokenPairHash];
    }

    /**
     * @notice Updates the pool implementation address
     * @param newImplementation The new pool implementation address
     */
    function updatePoolImplementation(address newImplementation) external onlyAdmin {
        if (newImplementation == address(0)) {
            revert Errors.ZeroAddress();
        }
        poolImplementation = newImplementation;
    }

    /**
     * @notice Gets the hash of a pool key
     * @param key The pool key
     * @return keyHash The hash of the pool key
     */
    function _getPoolKeyHash(PoolKey calldata key) private pure returns (bytes32 keyHash) {
        return keccak256(abi.encode(key.currency0, key.currency1, key.fee, key.tickSpacing, key.hooks));
    }

    /**
     * @notice Gets the hash of a token pair
     * @param token0 First token address
     * @param token1 Second token address
     * @return pairHash The hash of the token pair
     */
    function _getTokenPairHash(address token0, address token1) private pure returns (bytes32 pairHash) {
        return keccak256(abi.encode(token0, token1));
    }

    /**
     * @inheritdoc IPoolManager
     */
    function swap(PoolKey calldata key, IPoolManager.SwapParams calldata params, bytes calldata hookData)
        external
        override
        returns (BalanceDelta memory delta)
    {
        bytes32 keyHash = _getPoolKeyHash(key);
        address pool = _pools[keyHash];

        if (pool == address(0)) {
            revert Errors.PoolNotFound();
        }

        if (_poolInfo[keyHash].paused) {
            revert Errors.PoolPaused();
        }

        // Call the pool's swap function
        // This is a placeholder - actual implementation would depend on pool interface
        return BalanceDelta({amount0: 0, amount1: 0});
    }

    /**
     * @inheritdoc IPoolManager
     */
    function modifyPosition(
        PoolKey calldata key,
        IPoolManager.ModifyPositionParams calldata params,
        bytes calldata hookData
    ) external override returns (BalanceDelta memory delta) {
        bytes32 keyHash = _getPoolKeyHash(key);
        address pool = _pools[keyHash];

        if (pool == address(0)) {
            revert Errors.PoolNotFound();
        }

        if (_poolInfo[keyHash].paused) {
            revert Errors.PoolPaused();
        }

        // Call the pool's modifyPosition function
        // This is a placeholder - actual implementation would depend on pool interface
        return BalanceDelta({amount0: 0, amount1: 0});
    }

    /**
     * @inheritdoc IPoolManager
     */
    function initialize(PoolKey calldata key, uint160 sqrtPriceX96, bytes calldata hookData) external override {
        bytes32 keyHash = _getPoolKeyHash(key);
        address pool = _pools[keyHash];

        if (pool == address(0)) {
            revert Errors.PoolNotFound();
        }

        // Call the pool's initialize function
        // This is a placeholder - actual implementation would depend on pool interface
    }
}
