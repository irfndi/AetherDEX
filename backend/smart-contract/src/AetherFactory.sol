// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.29; // UPDATED PRAGMA VERSION TO 0.8.28

import "./AetherPool.sol";

/**
 * @title AetherFactory
 * @author AetherDEX
 * @notice Factory contract to deploy and manage AetherPool contracts.
 */
contract AetherFactory {
    /**
     * @notice Mapping to get the pool address for a given token pair.
     * @notice Returns pool address of the AetherPool contract for the token pair, or address(0) if no pool exists.
     */
    mapping(address => mapping(address => address)) public getPool;
    /**
     * @notice Array of all deployed pool addresses.
     * @notice Returns array of AetherPool contract addresses.
     */
    address[] public allPools;
    uint256 public nonce; // ADD NONCE

    /**
     * @notice Creates a new AetherPool contract for the given token pair.
     * @param tokenA Address of token A.
     * @param tokenB Address of token B.
     * @return pool address of the newly created AetherPool contract.
     * @dev Reverts if token addresses are identical, zero address, or if a pool already exists for the token pair.
     */
    function createPool(address tokenA, address tokenB) external returns (address pool) {
        nonce++; // INCREMENT NONCE
        require(tokenA != tokenB, "IDENTICAL_ADDRESSES");
        (address token0, address token1) = tokenA < tokenB ? (tokenA, tokenB) : (tokenB, tokenA);
        require(token0 != address(0), "ZERO_ADDRESS");
        console2.log("ZERO_ADDRESS check passed"); // Log after ZERO_ADDRESS check
        require(getPool[token0][token1] == address(0), "POOL_EXISTS");
        console2.log("POOL_EXISTS check passed"); // Log after POOL_EXISTS check

        // bytes memory bytecode = type(AetherPool).creationCode;
        // // bytes32 salt = keccak256(abi.encodePacked(token0, token1, block.number, nonce)); // USE block.number IN SALT
        // // bytes32 salt = keccak256(abi.encodePacked(token0, token1, block.number, nonce)); // USE block.number IN SALT
        // bytes32 salt = keccak256(abi.encodePacked(token0, token1, block.number, nonce, address(this))); // ADD FACTORY ADDRESS TO SALT
        // assembly {
        //     pool := create2(0, add(bytecode, 32), mload(bytecode), salt)
        // }
        pool = address(new AetherPool(address(this))); // DEPLOY WITH STANDARD NEW KEYWORD
        console2.log("Pool created at:", pool); // Log pool address after creation
        // if (pool == address(0)) revert("CREATE2_FAILED"); // REVERT IF CREATE2 FAILS
        // console2.log("CREATE2 check passed"); // Log after CREATE2 check
        AetherPool(pool).initialize(token0, token1);
        console2.log("Pool initialized"); // Log after initialization

        getPool[token0][token1] = pool;
        getPool[token1][token0] = pool;
        allPools.push(pool);
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
