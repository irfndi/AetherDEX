// SPDX-License-Identifier: MIT
pragma solidity ^0.8.31;

import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Errors} from "../lib/Errors.sol";
import {IAetherFactory} from "../interfaces/IAetherFactory.sol";

/// @title AetherFactory
/// @notice Creates and registers V4 pools via the singleton PoolManager
/// @dev Pools are identified by deterministic PoolId (keccak256 of PoolKey)
///      No child contracts are deployed — V4 pools are state within PoolManager
contract AetherFactory is IAetherFactory, Ownable {
    using PoolIdLibrary for PoolKey;

    /// @notice The Uniswap V4 PoolManager singleton
    IPoolManager public immutable poolManager;

    /// @notice Whitelisted hook contract applied to all factory-created pools
    IHooks public immutable hook;

    /// @notice poolId => PoolKey mapping for registered pools
    mapping(bytes32 => PoolKey) public poolKeys;

    /// @notice creator => poolId => bool tracking who created each pool
    mapping(address => mapping(bytes32 => bool)) public poolCreatedBy;

    /// @notice Ordered list of all registered poolIds
    bytes32[] public allPools;

    /// @notice Emitted when a new pool is created and initialized
    event PoolCreated(
        bytes32 indexed poolId,
        address indexed creator,
        address indexed token0,
        address token1,
        uint24 fee,
        int24 tickSpacing,
        uint160 sqrtPriceX96,
        int24 tick
    );

    constructor(IPoolManager _poolManager, IHooks _hook, address _initialOwner) Ownable(_initialOwner) {
        if (address(_poolManager) == address(0)) revert Errors.ZeroAddress();
        if (address(_hook) == address(0)) revert Errors.ZeroAddress();
        poolManager = _poolManager;
        hook = _hook;
    }

    /// @notice Create and initialize a new V4 pool
    /// @dev Tokens must be sorted: address(token0) < address(token1)
    /// @param token0 First token (lower address)
    /// @param token1 Second token (higher address)
    /// @param fee Pool fee tier in hundredths of a bip (e.g. 3000 = 0.3%)
    /// @param tickSpacing Minimum tick spacing for concentrated liquidity positions
    /// @param sqrtPriceX96 Initial sqrt price as Q64.96 fixed-point
    /// @return poolId Deterministic identifier: keccak256(abi.encode(PoolKey))
    function createPool(
        address token0,
        address token1,
        uint24 fee,
        int24 tickSpacing,
        uint160 sqrtPriceX96
    ) external returns (bytes32 poolId) {
        if (token0 == token1) revert Errors.InvalidPair();
        if (token0 >= token1) revert Errors.InvalidPair();
        if (sqrtPriceX96 == 0) revert Errors.ZeroAmount();
        if (fee == 0) revert Errors.InvalidFee();

        PoolKey memory key =
            PoolKey({currency0: Currency.wrap(token0), currency1: Currency.wrap(token1), fee: fee, tickSpacing: tickSpacing, hooks: hook});

        poolId = PoolId.unwrap(key.toId());

        // Revert if pool already exists (fee is non-zero in a valid PoolKey)
        if (poolKeys[poolId].fee != 0) revert Errors.PoolAlreadyExists();

        // Store pool registry BEFORE external call (reentrancy protection — CEI pattern)
        poolKeys[poolId] = key;
        poolCreatedBy[msg.sender][poolId] = true;
        allPools.push(poolId);

        // Initialize pool state in the V4 PoolManager singleton
        int24 tick = poolManager.initialize(key, sqrtPriceX96);

        emit PoolCreated(poolId, msg.sender, token0, token1, fee, tickSpacing, sqrtPriceX96, tick);
    }

    /// @notice Get the PoolKey for a registered pool
    /// @param poolId The keccak256-encoded PoolKey identifier
    function getPool(bytes32 poolId) external view returns (PoolKey memory) {
        if (poolKeys[poolId].fee == 0) revert Errors.PoolNotFound();
        return poolKeys[poolId];
    }

    /// @notice Total number of registered pools
    function poolCount() external view returns (uint256) {
        return allPools.length;
    }

    /// @notice Get pool key at array index
    /// @param index Zero-based index into allPools array
    function getPoolAt(uint256 index) external view returns (PoolKey memory) {
        if (index >= allPools.length) revert Errors.PoolIndexOutOfBounds();
        return poolKeys[allPools[index]];
    }
}
