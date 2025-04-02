// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.29;

// import {console2} from "forge-std/console2.sol"; // Removed unused import
import "./AetherPool.sol";
import {IFeeRegistry} from "./interfaces/IFeeRegistry.sol";
import {PoolKey} from "./types/PoolKey.sol"; // Import PoolKey

/**
 * @title AetherFactory
 * @author AetherDEX
 * @notice Factory contract to deploy and manage AetherPool contracts using CREATE2.
 */
contract AetherFactory {
    /** @notice Address of the fee registry contract (optional, may not be needed if validation happens elsewhere) */
    IFeeRegistry public immutable feeRegistry; // Keep for potential future use or context, but not used in createPool

    /**
     * @notice Mapping from PoolKey hash (poolId) to the deployed pool address.
     * @notice Returns pool address of the AetherPool contract for the given PoolKey hash, or address(0) if no pool exists.
     */
    mapping(bytes32 => address) public getPool;
    /**
     * @notice Array of all deployed pool addresses.
     * @notice Returns array of AetherPool contract addresses.
     */
    address[] public allPools;
    // uint256 public nonce; // Removed nonce, CREATE2 salt provides uniqueness

    /**
     * @notice Emitted when a new pool is created.
     * @param poolId The hash of the PoolKey identifying the pool.
     * @param pool The address of the newly deployed AetherPool contract.
     * @param key The PoolKey used to create the pool.
     */
    event PoolCreated(bytes32 indexed poolId, address indexed pool, PoolKey key);

    /**
     * @notice Constructor to set the fee registry address.
     * @param _feeRegistry Address of the IFeeRegistry implementation.
     */
    constructor(address _feeRegistry) {
        // FeeRegistry might still be relevant for other factory functions or context,
        // but the require check is removed as it's not strictly needed for CREATE2 deployment logic.
        // require(_feeRegistry != address(0), "ZERO_ADDRESS");
        feeRegistry = IFeeRegistry(_feeRegistry);
    }

    /**
     * @notice Creates a new AetherPool contract for the given PoolKey using CREATE2.
     * @param key The PoolKey struct containing all parameters (tokens, fee, tickSpacing, hooks).
     * @return pool Address of the newly created AetherPool contract.
     * @dev Deploys deterministically using CREATE2. Reverts if tokens are identical or zero,
     *      or if a pool with the same PoolKey hash already exists.
     *      Assumes token0 < token1 in the provided key.
     */
    function createPool(PoolKey memory key) external returns (address pool) {
        // Input validation
        require(key.token0 != key.token1, "IDENTICAL_ADDRESSES");
        require(key.token0 != address(0), "ZERO_ADDRESS_TOKEN0"); // Check token0 specifically
        // require(key.token1 != address(0), "ZERO_ADDRESS_TOKEN1"); // token1 implicitly checked by token0 < token1 convention
        require(key.token0 < key.token1, "UNSORTED_TOKENS"); // Enforce convention

        // Calculate poolId (hash of the key)
        bytes32 poolId = keccak256(abi.encode(key));
        require(getPool[poolId] == address(0), "POOL_EXISTS");

        // Prepare for CREATE2 deployment
        bytes memory bytecode = type(AetherPool).creationCode;
        // Pass the factory address to the AetherPool constructor
        bytes memory constructorArgs = abi.encode(address(this));
        bytes memory deploymentCode = abi.encodePacked(bytecode, constructorArgs);
        bytes32 salt = poolId; // Use the unique poolId as the salt

        // Deploy using CREATE2
        assembly {
            pool := create2(0, add(deploymentCode, 0x20), mload(deploymentCode), salt)
        }
        require(pool != address(0), "CREATE2_FAILED");

        // Initialize the newly created pool
        // Note: AetherPool.initialize currently only uses token0, token1, and fee.
        // It ignores tickSpacing and hooks from the PoolKey.
        AetherPool(pool).initialize(key.token0, key.token1, key.fee);

        // Store pool address and update records
        getPool[poolId] = pool;
        allPools.push(pool);

        emit PoolCreated(poolId, pool, key);

        return pool;
    }

    /**
     * @notice Returns the total number of pools deployed by this factory.
     * @return uint256 poolCount Total number of AetherPool contracts deployed.
     */
    function poolCount() external view returns (uint256) {
        return allPools.length;
    }
}
