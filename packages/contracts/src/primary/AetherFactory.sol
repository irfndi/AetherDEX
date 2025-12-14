// SPDX-License-Identifier: GPL-3.0

/*
Created by irfndi (github.com/irfndi) - Apr 2025
Email: join.mantap@gmail.com
*/

pragma solidity ^0.8.31;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IAetherPool} from "../interfaces/IAetherPool.sol";
import {IFeeRegistry} from "../interfaces/IFeeRegistry.sol";
import {Errors} from "../libraries/Errors.sol";

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
     * @notice Mapping from pool key hash to pool address
     */
    mapping(bytes32 => address) public getPool;

    /**
     * @notice Legacy mapping for backward compatibility (token pair to pool)
     */
    mapping(address => mapping(address => address)) public getPoolLegacy;

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
    event PoolCreated(
        address indexed token0, address indexed token1, uint24 indexed fee, address pool, uint256 allPoolsLength
    );

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
        if (_feeRegistry == address(0)) revert Errors.ZeroAddress();
        feeRegistry = IFeeRegistry(_feeRegistry);
        currentPoolFee = _initialPoolFee;
    }

    /**
     * @notice Creates a new AetherPool for the given pair of tokens.
     * @param token0 The first token in the pool.
     * @param token1 The second token in the pool.
     * @param fee The fee tier for the pool.
     * @return pool The address of the newly created AetherPool contract.
     */
    function createPool(address token0, address token1, uint24 fee) external nonReentrant returns (address pool) {
        // Input validation
        if (token0 == address(0) || token1 == address(0)) {
            revert Errors.ZeroAddress();
        }
        if (token0 == token1) {
            revert Errors.IdenticalAddresses();
        }
        if (fee == 0 || fee > 10000) {
            // Fee should be between 0.01% and 100%
            revert Errors.InvalidFeeTier();
        }

        // Ensure token0 < token1 for consistent ordering
        if (token0 > token1) {
            (token0, token1) = (token1, token0);
        }

        // Check if pool already exists
        bytes32 poolKey = keccak256(abi.encodePacked(token0, token1, fee));
        if (getPool[poolKey] != address(0)) {
            revert Errors.PoolAlreadyExists();
        }

        // Generate deterministic salt for CREATE2
        bytes32 salt = keccak256(abi.encodePacked(token0, token1, fee));

        // Note: Since AetherPool is implemented in Vyper, we need the compiled bytecode
        // This is a placeholder for the actual Vyper bytecode deployment
        // In practice, you would have the compiled Vyper bytecode here
        bytes memory bytecode = getPoolBytecode();

        // Deploy using CREATE2
        assembly {
            pool := create2(0, add(bytecode, 0x20), mload(bytecode), salt)
        }

        if (pool == address(0)) {
            revert Errors.PoolCreationFailed();
        }

        // Initialize the pool with token addresses and fee
        IAetherPool(pool).initialize(token0, token1, fee);

        // Store pool mapping
        getPool[poolKey] = pool;
        getPoolLegacy[token0][token1] = pool; // Legacy mapping
        getPoolLegacy[token1][token0] = pool; // Allow lookup in reverse order too
        allPools.push(pool);

        emit PoolCreated(token0, token1, fee, pool, allPools.length);
    }

    /**
     * @notice Registers an externally deployed AetherPool instance.
     * @param poolAddress The address of the deployed AetherPool contract.
     * @param tokenA One of the tokens in the pool.
     * @param tokenB The other token in the pool.
     */
    function registerPool(address poolAddress, address tokenA, address tokenB) external nonReentrant {
        if (tokenA == tokenB) revert Errors.IdenticalAddresses();
        if (tokenA == address(0) || tokenB == address(0) || poolAddress == address(0)) revert Errors.ZeroAddress();

        // Ensure tokens are ordered
        (address token0, address token1) = tokenA < tokenB ? (tokenA, tokenB) : (tokenB, tokenA);

        bytes32 poolKey = keccak256(abi.encodePacked(token0, token1, IAetherPool(poolAddress).fee()));
        if (getPool[poolKey] != address(0)) revert Errors.PoolAlreadyExists();

        getPool[poolKey] = poolAddress;
        getPoolLegacy[token0][token1] = poolAddress;
        getPoolLegacy[token1][token0] = poolAddress; // Allow lookup in reverse order too
        allPools.push(poolAddress);

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

    /**
     * @notice Get the bytecode for AetherPool deployment
     * @dev DESIGN DECISION - Pool Deployment Patterns:
     *
     * Pattern 1: createPool() with bytecode (this function)
     *   - Uses minimal proxy for testing and development
     *   - For production with CREATE2, inject compiled Vyper bytecode:
     *     vyper --evm-version cancun src/security/AetherPool.vy -f bytecode
     *
     * Pattern 2: registerPool() (RECOMMENDED for Vyper pools)
     *   - Deploy Vyper pool externally using `vyper -f bytecode`
     *   - Call registerPool(poolAddress, tokenA, tokenB) to register
     *   - This pattern is preferred because:
     *     a) Vyper compilation is separate from Solidity deployment
     *     b) Pool bytecode doesn't inflate factory contract size
     *     c) Supports factory upgrades without redeploying pools
     *
     * Current implementation uses minimal proxy for testing.
     * Production deployments should use registerPool() pattern.
     *
     * @return bytecode The bytecode for pool deployment (minimal proxy for testing)
     */
    function getPoolBytecode() internal pure returns (bytes memory) {
        // NOTE: createPool() is disabled until real pool bytecode is configured.
        // The minimal proxy pattern below delegates to factory which doesn't implement IAetherPool.
        // Use registerPool() instead: deploy Vyper pool externally then register.
        revert("AetherFactory: pool bytecode not configured; use registerPool()");
    }

    /**
     * @notice Compute the CREATE2 address for a pool
     * @param token0 The first token address
     * @param token1 The second token address
     * @param fee The fee tier
     * @return pool The computed pool address
     */
    function computePoolAddress(address token0, address token1, uint24 fee) external view returns (address pool) {
        // Ensure token0 < token1 for consistent ordering
        if (token0 > token1) {
            (token0, token1) = (token1, token0);
        }

        bytes32 salt = keccak256(abi.encodePacked(token0, token1, fee));
        bytes memory bytecode = getPoolBytecode();
        bytes32 bytecodeHash = keccak256(bytecode);

        pool = address(uint160(uint256(keccak256(abi.encodePacked(bytes1(0xff), address(this), salt, bytecodeHash)))));
    }

    /**
     * @notice Get pool address by tokens and fee
     * @param token0 The first token address
     * @param token1 The second token address
     * @param fee The fee tier
     * @return pool The pool address (zero if doesn't exist)
     */
    function getPoolAddress(address token0, address token1, uint24 fee) external view returns (address pool) {
        // Ensure token0 < token1 for consistent ordering
        if (token0 > token1) {
            (token0, token1) = (token1, token0);
        }

        bytes32 poolKey = keccak256(abi.encodePacked(token0, token1, fee));
        pool = getPool[poolKey];
    }
}
