// SPDX-License-Identifier: GPL-3.0

/*
Created by irfndi (github.com/irfndi) - Apr 2025
Email: join.mantap@gmail.com
*/

pragma solidity ^0.8.31;

import {IPoolManager} from "../../src/interfaces/IPoolManager.sol";
import {IAetherPool} from "../../src/interfaces/IAetherPool.sol";
import {BaseHook} from "../../src/hooks/BaseHook.sol";
import {Hooks} from "../../src/libraries/Hooks.sol";
import {PoolKey} from "../../lib/v4-core/src/types/PoolKey.sol";
import {BalanceDelta} from "../../src/types/BalanceDelta.sol";
import {Currency} from "../../lib/v4-core/src/types/Currency.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {TransferHelper} from "../../src/libraries/TransferHelper.sol";
import {TickMath} from "../../lib/v4-core/src/libraries/TickMath.sol";

contract MockPoolManager is IPoolManager {
    // Use a mapping to store multiple pools by their ID (hash of PoolKey)
    mapping(bytes32 => address) public pools;
    // address public immutable hookAddress; // Make mutable for test setup flexibility
    address public hookAddress;
    BalanceDelta private _balanceDelta;

    // Events
    event SwapHookCalled(bool beforeSwap, address sender, BalanceDelta delta);
    event HookError(string reason);

    // Constructor now only takes the hook address
    constructor(address _hookAddress) {
        hookAddress = _hookAddress; // Can be address(0) initially
    }

    // Function to set the pool address after deployment, now takes poolId
    // Allow setting multiple pools
    function setPool(bytes32 poolId, address _poolAddress) external {
        // Remove the check preventing multiple sets
        // require(pools[poolId] == address(0), "MPM: Pool already set for this ID");
        require(_poolAddress != address(0), "MPM: Invalid pool address");
        pools[poolId] = _poolAddress;
    }

    // Function to update hook address after deployment (no change needed)
    function setHookAddress(address _newHookAddress) external {
        hookAddress = _newHookAddress;
    }

    // Minimal struct definition matching AetherRouter's expected callback data
    struct SwapCallbackData {
        bytes path;
        address payer;
    }

    function swap(PoolKey calldata key, SwapParams calldata params, bytes calldata hookData)
        external
        override
        returns (BalanceDelta memory delta)
    {
        // Validate key and get the pool address
        address poolAddress = _validateKey(key); // Use the returned address

        // Skip actual pool operations if no contract at poolAddress (placeholder)
        if (address(poolAddress).code.length == 0) {
            // Return default zero delta without reverting
            return delta;
        }

        // Handle pre-swap hook
        _handleBeforeSwapHook(key, params, hookData);

        // --- Execute Swap on the actual pool ---
        IAetherPool targetPool = IAetherPool(poolAddress); // Use the validated address

        // Determine tokenIn and amountIn
        address tokenIn = params.zeroForOne ? Currency.unwrap(key.currency0) : Currency.unwrap(key.currency1);
        uint256 amountIn = uint256(params.amountSpecified);
        require(amountIn > 0, "MPM: Invalid swap amount");

        // ***** ADDED STEP *****
        // Pull tokenIn from Router (msg.sender) to the actual pool
        TransferHelper.safeTransferFrom(tokenIn, msg.sender, address(targetPool), amountIn);

        // 2. Call the actual pool's swap function, sending output to the Router (msg.sender)
        // The pool assumes it has already received tokenIn.
        uint256 amountOut = targetPool.swap(
            amountIn, // uint256 amountIn (already transferred to pool)
            tokenIn, // address tokenIn
            msg.sender // address to (send output tokens to the Router)
        );

        // 3. Calculate BalanceDelta (from pool's perspective - simplified for mock)
        int256 amount0Change;
        int256 amount1Change;
        if (params.zeroForOne) {
            // Pool receives token0 (amountIn), sends token1 (amountOut)
            amount0Change = int256(amountIn); // Positive: Pool received token0
            amount1Change = -int256(amountOut); // Negative: Pool sent token1
        } else {
            // Pool receives token1 (amountIn), sends token0 (amountOut)
            amount1Change = int256(amountIn); // Positive: Pool received token1
            amount0Change = -int256(amountOut); // Negative: Pool sent token0
        }
        delta = BalanceDelta(amount0Change, amount1Change);

        // Handle post-swap hook
        _handleAfterSwapHook(key, params, delta, hookData);

        return delta;
        // Note: The pool's swap now sends tokenOut directly to the recipient (msg.sender).
        // No need for the manager to transfer tokenOut back.
    }

    // Validate against the specific pool associated with the key
    function _validateKey(PoolKey calldata key) internal view returns (address poolAddress) {
        bytes32 poolId = keccak256(abi.encode(key));
        poolAddress = pools[poolId];
        require(poolAddress != address(0), "MPM: Pool not found for key");
        // Validate tokens against the retrieved pool instance
        IAetherPool targetPool = IAetherPool(poolAddress);
        (address poolToken0, address poolToken1) = targetPool.tokens();
        require(Currency.unwrap(key.currency0) == poolToken0, "MPM: Invalid token0");
        require(Currency.unwrap(key.currency1) == poolToken1, "MPM: Invalid token1");
        // Hook validation remains the same, assuming hookAddress is global for the mock
        require(address(key.hooks) == hookAddress, "MPM: Invalid hook address");
    }

    function _handleBeforeSwapHook(PoolKey calldata key, SwapParams calldata params, bytes calldata hookData) internal {
        if (hookAddress != address(0)) {
            try BaseHook(hookAddress).beforeSwap(msg.sender, key, params, hookData) returns (bytes4 selector) {
                require(selector == BaseHook.beforeSwap.selector, "MPM: Invalid hook selector");
                emit SwapHookCalled(true, msg.sender, BalanceDelta(0, 0));
            } catch Error(string memory reason) {
                emit HookError(reason);
                revert(reason);
            }
        }
    }

    // Removed unused _executeSwap function

    function _calculateDelta(
        bool zeroForOne,
        uint256 balanceInBefore,
        uint256 balanceOutBefore,
        uint256 balanceInAfter,
        uint256 balanceOutAfter
    ) internal pure returns (BalanceDelta memory) {
        int256 amount0Change;
        int256 amount1Change;

        if (zeroForOne) {
            amount0Change = int256(balanceInAfter - balanceInBefore);
            amount1Change = int256(balanceOutAfter) - int256(balanceOutBefore);
        } else {
            amount1Change = int256(balanceInAfter - balanceInBefore);
            amount0Change = int256(balanceOutAfter) - int256(balanceOutBefore);
        }

        return BalanceDelta(amount0Change, amount1Change);
    }

    function _handleAfterSwapHook(
        PoolKey calldata key,
        SwapParams calldata params,
        BalanceDelta memory delta,
        bytes calldata hookData
    ) internal {
        if (hookAddress != address(0)) {
            try BaseHook(hookAddress).afterSwap(msg.sender, key, params, delta, hookData) returns (bytes4 selector) {
                require(selector == BaseHook.afterSwap.selector, "MPM: Invalid hook selector");
                emit SwapHookCalled(false, msg.sender, delta);
            } catch Error(string memory reason) {
                emit HookError(reason);
                revert(reason);
            }
        }
    }

    // Testing helper functions
    function setBalanceDelta(int256 amount0, int256 amount1) external {
        _balanceDelta = BalanceDelta(amount0, amount1);
    }

    function getBalanceDelta() public view returns (BalanceDelta memory) {
        return _balanceDelta;
    }

    // State variables to track initialization
    mapping(bytes32 => bool) public initializedPools; // Use poolId for mapping
    mapping(bytes32 => uint160) public initialSqrtPriceX96;
    mapping(bytes32 => int24) public initialTick; // Store the initial tick

    /// @inheritdoc IPoolManager
    function modifyPosition(
        PoolKey calldata key,
        ModifyPositionParams calldata params,
        bytes calldata /* hookData */
    )
        external
        override
        returns (BalanceDelta memory delta)
    {
        // Determine pool address and skip for placeholders without code
        bytes32 poolId = keccak256(abi.encode(key));
        address poolAddress = pools[poolId];
        if (address(poolAddress).code.length == 0) {
            return delta;
        }
        // Validate key for actual pools
        poolAddress = _validateKey(key);

        IAetherPool targetPool = IAetherPool(poolAddress); // Get pool instance

        if (params.liquidityDelta > 0) {
            // --- Mint Liquidity ---
            // Cast int256 to uint256 first, then to uint128, as we know it's positive here.
            uint128 liquidityToAdd = uint128(uint256(params.liquidityDelta));
            require(liquidityToAdd > 0, "MPM: Liquidity delta must be positive");

            // 1. Call the actual pool's mint function to determine required token amounts
            //    The pool calculates amounts based on liquidity and reserves.
            //    NOTE: The actual AetherPool.mint will revert here until implemented, which is expected in later tests.
            (uint256 requiredAmount0, uint256 requiredAmount1) = targetPool.mint(msg.sender, liquidityToAdd);

            // *** MOCK ASSERTION ***: Check if pool requested any tokens.
            // In a real scenario, the pool would revert if calculation fails.
            require(requiredAmount0 > 0 || requiredAmount1 > 0, "MPM: Pool reported zero amounts needed for mint");

            // 2. Transfer required tokens FROM msg.sender TO pool
            //    (Requires approval in test setup)
            if (requiredAmount0 > 0) {
                TransferHelper.safeTransferFrom(
                    Currency.unwrap(key.currency0), msg.sender, address(targetPool), requiredAmount0
                );
            }
            if (requiredAmount1 > 0) {
                TransferHelper.safeTransferFrom(
                    Currency.unwrap(key.currency1), msg.sender, address(targetPool), requiredAmount1
                );
            }

            // 3. Calculate delta (positive = pool received)
            delta = BalanceDelta(int256(requiredAmount0), int256(requiredAmount1));
            // ----------------------------------
        } else if (params.liquidityDelta < 0) {
            // Removing liquidity (burn)
            uint256 liquidityToRemove = uint256(-params.liquidityDelta);
            require(liquidityToRemove > 0, "MPM: Burn amount must be positive"); // Sanity check

            // Call the actual pool's burn function
            // The pool is responsible for checks like sufficient liquidity and transferring tokens
            (uint256 amount0, uint256 amount1) = targetPool.burn(msg.sender, liquidityToRemove);

            // Delta from the pool's perspective (negative means sent out)
            delta = BalanceDelta(-int256(amount0), -int256(amount1));
        } else {
            // liquidityDelta is zero, return zero delta
            delta = BalanceDelta(0, 0);
            // Revert if liquidityDelta is zero, as per V4 core behavior
            revert("LiquidityDelta=0");
        }
    }

    // Marked as pure as they only revert
    function donate(PoolKey calldata, uint256, uint256, bytes calldata) external pure {
        revert("MPM: Not implemented");
    }

    // Marked as pure as they only revert
    function take(PoolKey calldata, address, uint256, uint256, bytes calldata) external pure {
        revert("MPM: Not implemented");
    }

    // Marked as pure as they only revert
    function settle(address) external pure returns (BalanceDelta memory, BalanceDelta memory) {
        revert("MPM: Not implemented");
    }

    // Marked as pure as they only revert
    function mint(address, PoolKey calldata, uint256, uint256, bytes calldata) external pure {
        revert("MPM: Not implemented");
    }

    // Marked as pure as they only revert
    function burn(address, PoolKey calldata, uint256, uint256, bytes calldata) external pure {
        revert("MPM: Not implemented");
    }

    function validateHookAddress(bytes32) external view returns (bool) {
        return hookAddress != address(0);
    }

    /// @inheritdoc IPoolManager
    function initialize(PoolKey calldata key, uint160 sqrtPriceX96, bytes calldata hookData) external override {
        // Basic implementation for mock: store initialization status and parameters
        bytes32 poolId = keccak256(abi.encode(key));
        require(!initializedPools[poolId], "MPM: Pool already initialized");

        initializedPools[poolId] = true;
        initialSqrtPriceX96[poolId] = sqrtPriceX96;
        // Simulate calculating tick from sqrtPriceX96 (can be simplified for mock)
        // For simplicity, let's just use 0 or a fixed value.
        // If tests require a specific tick calculation, this needs refinement.
        // int24 tick = 0; // Placeholder tick value
        int24 tick = TickMath.getTickAtSqrtPrice(sqrtPriceX96);
        initialTick[poolId] = tick;

        // Ensure the actual pool instance is initialized as well
        address poolAddress = pools[poolId]; // Get pool address
        require(poolAddress != address(0), "MPM: Pool not set for this ID");
        // IAetherPool targetPool = IAetherPool(poolAddress); // Get pool instance // Commented out as unused
        // targetPool.initialize(key.token0, key.token1, key.fee); // Removed initialize call

        // Call afterInitialize hook if present
        if (address(key.hooks) != address(0)) {
            BaseHook(address(key.hooks)).afterInitialize(msg.sender, key, sqrtPriceX96, hookData);
        }
        // No revert needed here as we are implementing the function
    }

    // --- Pool Query --- //

    function getPool(PoolKey calldata key) external view override returns (address poolAddress) {
        bytes32 poolId = keccak256(abi.encode(key));
        poolAddress = pools[poolId];
        // Don't require - return address(0) if not found as per interface
    }

    // Missing IPoolManager functions implementation
    function createPool(PoolKey calldata key) external override returns (address pool) {
        bytes32 poolId = keccak256(abi.encode(key));
        pool = pools[poolId];
        require(pool != address(0), "MPM: Pool not set for this key");
        return pool;
    }

    function poolExists(PoolKey calldata key) external view override returns (bool exists) {
        bytes32 poolId = keccak256(abi.encode(key));
        return pools[poolId] != address(0);
    }

    function getAllPools() external pure override returns (address[] memory) {
        revert("MPM: Not implemented");
    }

    function getPoolCount() external pure override returns (uint256) {
        revert("MPM: Not implemented");
    }

    function setPoolPauseStatus(PoolKey calldata, bool) external pure override {
        revert("MPM: Not implemented");
    }

    function updatePoolHooks(PoolKey calldata, address) external pure override {
        revert("MPM: Not implemented");
    }

    function updatePoolParameters(PoolKey calldata, uint24, int24) external pure override {
        revert("MPM: Not implemented");
    }

    function isPoolPaused(PoolKey calldata) external pure override returns (bool) {
        revert("MPM: Not implemented");
    }

    function getPoolInfo(PoolKey calldata key)
        external
        view
        override
        returns (address pool, bool paused, uint256 createdAt)
    {
        bytes32 poolId = keccak256(abi.encode(key));
        pool = pools[poolId];
        paused = false; // Mock implementation
        createdAt = 0; // Mock implementation
    }

    function validatePoolKey(PoolKey calldata) external pure override returns (bool) {
        return true; // Mock implementation - always valid
    }

    function migratePool(PoolKey calldata, address) external pure override {
        revert("MPM: Not implemented");
    }

    function getPoolsByTokenPair(address, address) external pure override returns (address[] memory) {
        revert("MPM: Not implemented");
    }
}
