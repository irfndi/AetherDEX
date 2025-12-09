// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "../../lib/v4-core/src/types/PoolKey.sol";
import "../types/BalanceDelta.sol";

/**
 * @title IPoolManager
 * @notice Interface for managing pool lifecycle and operations
 * @dev Defines the core functions for pool creation, management, and state tracking
 */
interface IPoolManager {
    /// @notice Parameters for swap operations
    struct SwapParams {
        bool zeroForOne;
        int256 amountSpecified;
        uint160 sqrtPriceLimitX96;
    }

    /// @notice Parameters for modifying liquidity positions
    struct ModifyPositionParams {
        int24 tickLower;
        int24 tickUpper;
        int256 liquidityDelta;
    }

    /// @notice Emitted when a new pool is created
    event PoolCreated(
        address indexed token0,
        address indexed token1,
        uint24 indexed fee,
        int24 tickSpacing,
        address hooks,
        address pool
    );

    /// @notice Emitted when pool parameters are updated
    event PoolParametersUpdated(PoolKey indexed poolKey, uint256 newFee, int24 newTickSpacing);

    /// @notice Emitted when a pool is paused or unpaused
    event PoolPauseStatusChanged(PoolKey indexed poolKey, bool paused);

    /// @notice Emitted when pool hooks are updated
    event PoolHooksUpdated(PoolKey indexed poolKey, address newHooks);

    /**
     * @notice Creates a new pool with the given parameters
     * @param key The pool key containing token addresses, fee, tick spacing, and hooks
     * @return pool The address of the created pool
     */
    function createPool(PoolKey calldata key) external returns (address pool);

    /**
     * @notice Gets the pool address for a given pool key
     * @param key The pool key
     * @return pool The pool address, or address(0) if pool doesn't exist
     */
    function getPool(PoolKey calldata key) external view returns (address pool);

    /**
     * @notice Checks if a pool exists for the given key
     * @param key The pool key
     * @return exists True if the pool exists
     */
    function poolExists(PoolKey calldata key) external view returns (bool exists);

    /**
     * @notice Gets all pools created by this manager
     * @return pools Array of pool addresses
     */
    function getAllPools() external view returns (address[] memory pools);

    /**
     * @notice Gets the total number of pools
     * @return count The number of pools
     */
    function getPoolCount() external view returns (uint256 count);

    /**
     * @notice Pauses or unpauses a specific pool
     * @param key The pool key
     * @param paused True to pause, false to unpause
     */
    function setPoolPauseStatus(PoolKey calldata key, bool paused) external;

    /**
     * @notice Updates the hooks contract for a pool
     * @param key The pool key
     * @param newHooks The new hooks contract address
     */
    function updatePoolHooks(PoolKey calldata key, address newHooks) external;

    /**
     * @notice Updates pool parameters (fee and tick spacing)
     * @param key The pool key
     * @param newFee The new fee (in hundredths of a bip)
     * @param newTickSpacing The new tick spacing
     */
    function updatePoolParameters(PoolKey calldata key, uint24 newFee, int24 newTickSpacing) external;

    /**
     * @notice Gets the pause status of a pool
     * @param key The pool key
     * @return paused True if the pool is paused
     */
    function isPoolPaused(PoolKey calldata key) external view returns (bool paused);

    /**
     * @notice Gets pool information
     * @param key The pool key
     * @return pool The pool address
     * @return paused Whether the pool is paused
     * @return createdAt Block timestamp when pool was created
     */
    function getPoolInfo(PoolKey calldata key) external view returns (address pool, bool paused, uint256 createdAt);

    /**
     * @notice Validates pool key parameters
     * @param key The pool key to validate
     * @return valid True if the key is valid
     */
    function validatePoolKey(PoolKey calldata key) external pure returns (bool valid);

    /**
     * @notice Emergency function to migrate a pool to a new implementation
     * @param key The pool key
     * @param newImplementation The new pool implementation address
     */
    function migratePool(PoolKey calldata key, address newImplementation) external;

    /**
     * @notice Gets pools by token pair
     * @param token0 First token address
     * @param token1 Second token address
     * @return pools Array of pool addresses for the token pair
     */
    function getPoolsByTokenPair(address token0, address token1) external view returns (address[] memory pools);

    /**
     * @notice Execute a swap in the specified pool
     * @param key The pool key
     * @param params The swap parameters
     * @param hookData Additional data for hooks
     * @return delta The balance changes from the swap
     */
    function swap(PoolKey calldata key, SwapParams calldata params, bytes calldata hookData)
        external
        returns (BalanceDelta memory delta);

    /**
     * @notice Modify liquidity position in the specified pool
     * @param key The pool key
     * @param params The position modification parameters
     * @param hookData Additional data for hooks
     * @return delta The balance changes from the position modification
     */
    function modifyPosition(PoolKey calldata key, ModifyPositionParams calldata params, bytes calldata hookData)
        external
        returns (BalanceDelta memory delta);

    /**
     * @notice Initialize a pool with the given sqrt price
     * @param key The pool key
     * @param sqrtPriceX96 The initial sqrt price
     * @param hookData Additional data for hooks
     */
    function initialize(PoolKey calldata key, uint160 sqrtPriceX96, bytes calldata hookData) external;
}
