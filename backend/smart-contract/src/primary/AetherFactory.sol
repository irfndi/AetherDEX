// SPDX-License-Identifier: GPL-3.0

/*
Created by irfndi (github.com/irfndi) - Apr 2025
Email: join.mantap@gmail.com
*/

pragma solidity ^0.8.29;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IAetherPool} from "../interfaces/IAetherPool.sol";
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
     * @notice Fee to be used for newly created pools. Can be updated by the owner.
     */
    uint24 public currentPoolFee;

    /**
     * @notice Emitted when a new pool is created.
     * @param token0 The first token in the pool.
     * @param token1 The second token in the pool.
     * @param fee The fee tier of the pool.
     * @param pool The address of the newly deployed AetherPool contract.
     * @param allPoolsLength The total number of pools after creation.
     */
    event PoolCreated(address indexed token0, address indexed token1, uint24 indexed fee, address pool, uint256 allPoolsLength);

    /**
     * @notice Emitted when the fee configuration for new pools is changed.
     * @param oldFee The previous fee.
     * @param newFee The new fee.
     */
    event FeeConfigurationChanged(uint24 oldFee, uint24 newFee);

    /**
     * @notice Constructor to set the initial owner, fee registry, and initial pool fee.
     * @param _initialOwner Address of the initial owner.
     * @param _feeRegistry Address of the IFeeRegistry implementation.
     * @param _initialPoolFee The initial fee for pools created by this factory.
     */
    constructor(address _initialOwner, address _feeRegistry, uint24 _initialPoolFee) Ownable(_initialOwner) {
        if (_feeRegistry == address(0)) revert("AetherFactory: ZERO_ADDRESS_FEE_REGISTRY");
        feeRegistry = IFeeRegistry(_feeRegistry);
        currentPoolFee = _initialPoolFee;
    }

    /**
     * @notice Creates a new AetherPool for the given pair of tokens.
     * @param tokenA One of the tokens in the pool.
     * @param tokenB The other token in the pool.
     * @return The address of the newly created AetherPool contract.
     */
    function createPool(address tokenA, address tokenB) external nonReentrant returns (address /*pool*/) {
        if (tokenA == tokenB) revert("AetherFactory: IDENTICAL_ADDRESSES");
        if (tokenA == address(0) || tokenB == address(0)) revert("AetherFactory: ZERO_ADDRESS");

        (address token0, address token1) = tokenA < tokenB ? (tokenA, tokenB) : (tokenB, tokenA);

        if (getPool[token0][token1] != address(0)) revert("AetherFactory: POOL_EXISTS");

        // TODO: Implement CREATE2 deployment of AetherPool.vy (Vyper contract)
        // The bytecode of AetherPool.vy needs to be obtained and used here.
        // Example of how it might look (actual bytecode retrieval and salt generation needed):
        // bytes32 salt = keccak256(abi.encodePacked(token0, token1, currentPoolFee));
        // bytes memory poolBytecode = getAetherPoolVyperBytecode(); // Placeholder for bytecode retrieval
        // assembly {
        //     pool := create2(0, add(poolBytecode, 0x20), mload(poolBytecode), salt)
        // }
        // if (pool == address(0)) revert("AetherFactory: CREATE2_FAILED");
        // For now, as a placeholder until CREATE2 is implemented:
        revert("AetherFactory: CREATE2 deployment for AetherPool.vy not yet implemented");

        // Unreachable code until CREATE2 is implemented and revert is removed:
        // IAetherPool(pool).initialize(token0, token1, currentPoolFee);
        //
        // getPool[token0][token1] = pool;
        // getPool[token1][token0] = pool; // Allow lookup in reverse order too
        // allPools.push(pool);
        //
        // emit PoolCreated(token0, token1, currentPoolFee, pool, allPools.length);
        // return pool; // This line is also part of the unreachable block if createPool is to return the address
    }

    /**
     * @notice Registers an externally deployed AetherPool instance.
     * @param poolAddress The address of the deployed AetherPool contract.
     * @param tokenA One of the tokens in the pool.
     * @param tokenB The other token in the pool.
     */
    function registerPool(address poolAddress, address tokenA, address tokenB) external nonReentrant {
        if (tokenA == tokenB) revert("AetherFactory: IDENTICAL_ADDRESSES_REGISTER");
        if (tokenA == address(0) || tokenB == address(0) || poolAddress == address(0)) revert("AetherFactory: ZERO_ADDRESS_REGISTER");

        // Ensure tokens are ordered
        (address token0, address token1) = tokenA < tokenB ? (tokenA, tokenB) : (tokenB, tokenA);

        if (getPool[token0][token1] != address(0)) revert("AetherFactory: POOL_EXISTS_REGISTER");

        getPool[token0][token1] = poolAddress;
        getPool[token1][token0] = poolAddress; // Allow lookup in reverse order too
        allPools.push(poolAddress);

        // Assuming IAetherPool has a 'fee()' getter or similar to retrieve the fee for the event.
        // If not, this part might need adjustment or removal of fee from this specific event emit.
        uint24 registeredFee = IAetherPool(poolAddress).fee(); 
        emit PoolCreated(token0, token1, registeredFee, poolAddress, allPools.length);
    }

    /**
     * @notice Sets the fee configuration for subsequently created pools.
     * @param newFee The new fee tier to be used for new pools.
     * @dev Only callable by the owner.
     */
    function setFeeConfiguration(uint24 newFee) external onlyOwner {
        uint24 oldFee = currentPoolFee;
        currentPoolFee = newFee;
        emit FeeConfigurationChanged(oldFee, newFee);
    }

    /**
     * @notice Returns the total number of pools deployed by this factory.
     * @return uint256 poolCount Total number of AetherPool contracts deployed.
     */
    function poolCount() external view returns (uint256) {
        return allPools.length;
    }
}
