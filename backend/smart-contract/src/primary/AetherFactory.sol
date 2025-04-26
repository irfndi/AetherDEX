// SPDX-License-Identifier: GPL-3.0

/*
Created by irfndi (github.com/irfndi) - Apr 2025
Email: join.mantap@gmail.com
*/

pragma solidity ^0.8.29;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
// Remove direct Pool import, use interface
import "../interfaces/IAetherPool.sol"; // Import the interface
import {IFeeRegistry} from "../interfaces/IFeeRegistry.sol";

/**
 * @title AetherFactory
 * @author AetherDEX
 * @notice Factory contract to deploy and manage AetherPool contracts using CREATE2.
 */
contract AetherFactory is
    ReentrancyGuard, // Inherit ReentrancyGuard
    Ownable
{
    /**
     * @notice Address of the fee registry contract (optional, may not be needed if validation happens elsewhere)
     */
    IFeeRegistry public immutable feeRegistry; // Keep for potential future use or context, but not used in createPool

    /**
     * @notice Mapping from PoolKey hash (poolId) to the deployed pool address.
     * @notice Returns pool address of the AetherPool contract for the given PoolKey hash, or address(0) if no pool exists.
     */
    mapping(address => mapping(address => address)) public getPool;
    /**
     * @notice Array of all deployed pool addresses.
     * @notice Returns array of AetherPool contract addresses.
     */
    address[] public allPools;

    /**
     * @notice Emitted when a new pool is created.
     * @param token0 The first token in the pool.
     * @param token1 The second token in the pool.
     * @param pool The address of the newly deployed AetherPool contract.
     */
    event PoolCreated(address indexed token0, address indexed token1, address indexed pool);

    /**
     * @notice Constructor to set the fee registry address.
     * @param _initialOwner Address of the initial owner.
     * @param _feeRegistry Address of the IFeeRegistry implementation.
     */
    constructor(address _initialOwner, address _feeRegistry) Ownable(_initialOwner) {
        if (_feeRegistry == address(0)) revert("ZERO_ADDRESS");
        feeRegistry = IFeeRegistry(_feeRegistry);
    }

    /**
     * @notice Registers an externally deployed AetherPool instance.
     * @param pool The address of the deployed AetherPool contract.
     * @param tokenA One of the tokens in the pool.
     * @param tokenB The other token in the pool.
     */
    function registerPool(address pool, address tokenA, address tokenB) external nonReentrant {
        if (tokenA == tokenB) revert("IDENTICAL_ADDRESSES");
        if (tokenA == address(0) || tokenB == address(0) || pool == address(0)) revert("ZERO_ADDRESS");

        // Ensure tokens are ordered
        (address token0, address token1) = tokenA < tokenB ? (tokenA, tokenB) : (tokenB, tokenA);

        if (getPool[token0][token1] != address(0)) revert("POOL_EXISTS");

        getPool[token0][token1] = pool;
        getPool[token1][token0] = pool; // Allow lookup in reverse order too
        allPools.push(pool);

        emit PoolCreated(token0, token1, pool);
    }

    /**
     * @notice Returns the total number of pools deployed by this factory.
     * @return uint256 poolCount Total number of AetherPool contracts deployed.
     */
    function poolCount() external view returns (uint256) {
        return allPools.length;
    }
}
