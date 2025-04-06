// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.29;

import {IPoolManager} from "../../src/interfaces/IPoolManager.sol";
import {AetherPool} from "../../src/AetherPool.sol";
import {BaseHook} from "../../src/hooks/BaseHook.sol";
import {Hooks} from "../../src/libraries/Hooks.sol";
import {PoolKey} from "../../src/types/PoolKey.sol";
import {BalanceDelta} from "../../src/types/BalanceDelta.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {TransferHelper} from "../../src/libraries/TransferHelper.sol";
import {TickMath} from "../../lib/v4-core/src/libraries/TickMath.sol";

contract MockPoolManager is IPoolManager {
    // AetherPool public immutable pool; // Make mutable to break constructor dependency
    AetherPool public pool;
    // address public immutable hookAddress; // Make mutable for test setup flexibility
    address public hookAddress;
    BalanceDelta private _balanceDelta;

    // Events
    event SwapHookCalled(bool beforeSwap, address sender, BalanceDelta delta);
    event HookError(string reason);

    // Constructor now only takes the hook address, pool is set later
    constructor(address _hookAddress) {
        // pool = AetherPool(_pool); // Pool address set later via setPool
        hookAddress = _hookAddress; // Can be address(0) initially
    }

    // Function to set the pool address after deployment
    function setPool(address _poolAddress) external {
        require(address(pool) == address(0), "MPM: Pool already set");
        pool = AetherPool(_poolAddress);
    }

    // Function to update hook address after deployment
    function setHookAddress(address _newHookAddress) external {
        hookAddress = _newHookAddress;
    }

    function swap(PoolKey calldata key, SwapParams calldata params, bytes calldata hookData)
        external
        override
        returns (BalanceDelta memory delta)
    {
        // Validate key
        _validateKey(key);

        // Handle pre-swap hook
        _handleBeforeSwapHook(key, params, hookData);

        // Execute swap and get delta
        delta = _executeSwap(key, params);

        // Handle post-swap hook
        _handleAfterSwapHook(key, params, delta, hookData);

        return delta;
    }

    function _validateKey(PoolKey calldata key) internal view {
        require(key.token0 == pool.token0(), "MPM: Invalid token0");
        require(key.token1 == pool.token1(), "MPM: Invalid token1");
        require(key.hooks == hookAddress, "MPM: Invalid hook address");
    }

    function _handleBeforeSwapHook(PoolKey calldata key, SwapParams calldata params, bytes calldata hookData)
        internal
    {
        if (hookAddress != address(0) && Hooks.hasPermission(hookAddress, Hooks.BEFORE_SWAP_FLAG)) {
            try BaseHook(hookAddress).beforeSwap(msg.sender, key, params, hookData) returns (bytes4 selector) {
                require(selector == BaseHook.beforeSwap.selector, "MPM: Invalid hook selector");
                emit SwapHookCalled(true, msg.sender, BalanceDelta(0, 0));
            } catch Error(string memory reason) {
                emit HookError(reason);
                revert(reason);
            }
        }
    }

    function _executeSwap(PoolKey calldata key, SwapParams calldata params) internal returns (BalanceDelta memory) {
        require(params.amountSpecified > 0, "MPM: Mock only supports exact input swaps");

        uint256 amountIn = uint256(params.amountSpecified);
        (address tokenIn, address tokenOut) = params.zeroForOne ? (key.token0, key.token1) : (key.token1, key.token0);

        // Record balances
        uint256 balanceInBefore = IERC20(tokenIn).balanceOf(address(pool));
        uint256 balanceOutBefore = IERC20(tokenOut).balanceOf(address(pool));

        // Execute swap
        pool.swap(amountIn, tokenIn, msg.sender, msg.sender);

        // Calculate delta
        return _calculateDelta(
            params.zeroForOne,
            balanceInBefore,
            balanceOutBefore,
            IERC20(tokenIn).balanceOf(address(pool)),
            IERC20(tokenOut).balanceOf(address(pool))
        );
    }

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
        if (hookAddress != address(0) && Hooks.hasPermission(hookAddress, Hooks.AFTER_SWAP_FLAG)) {
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
    function modifyPosition(PoolKey calldata key, ModifyPositionParams calldata params, bytes calldata /* hookData */)
        external
        override
        returns (BalanceDelta memory delta)
    {
        // Basic mock implementation: Assume adding liquidity
        // Transfer tokens from caller to the pool based on some logic
        // This is highly simplified and might need refinement based on actual tick logic if tests require it.
        _validateKey(key); // Ensure the key matches the associated pool

        // Simulate adding liquidity - transfer tokens from msg.sender to pool
        // WARNING: This mock doesn't calculate amounts based on ticks/price.
        // It assumes caller provides necessary tokens.
        // We need *some* amount transferred to make swap possible.
        // Let's use a fixed amount for simplicity in the mock, e.g., 100 tokens each.
        // A better mock might try to estimate amounts based on liquidityDelta.
        uint256 mockAmount0 = 100 ether;
        uint256 mockAmount1 = 100 ether;

        if (params.liquidityDelta > 0) { // Adding liquidity
            TransferHelper.safeTransferFrom(key.token0, msg.sender, address(pool), mockAmount0);
            TransferHelper.safeTransferFrom(key.token1, msg.sender, address(pool), mockAmount1);
            // Return a positive delta indicating tokens received by the pool (from manager's perspective)
            delta = BalanceDelta(int256(mockAmount0), int256(mockAmount1));
        } else if (params.liquidityDelta < 0) { // Removing liquidity
             // Simulate removing liquidity - transfer tokens from pool to msg.sender
            TransferHelper.safeTransfer(key.token0, msg.sender, mockAmount0); 
            TransferHelper.safeTransfer(key.token1, msg.sender, mockAmount1); 
            // Return a negative delta indicating tokens sent from the pool
            delta = BalanceDelta(-int256(mockAmount0), -int256(mockAmount1));
        } else {
             // liquidityDelta is zero, return zero delta
             delta = BalanceDelta(0,0);
        }

        // Note: Real modifyPosition involves complex tick math.
        // This mock bypasses that for basic testing.
    }

    function donate(PoolKey calldata, uint256, uint256, bytes calldata) external override {
        revert("MPM: Not implemented");
    }

    function take(PoolKey calldata, address, uint256, uint256, bytes calldata) external override {
        revert("MPM: Not implemented");
    }

    function settle(address) external override returns (BalanceDelta memory, BalanceDelta memory) {
        revert("MPM: Not implemented");
    }

    function mint(address, PoolKey calldata, uint256, uint256, bytes calldata) external override {
        revert("MPM: Not implemented");
    }

    function burn(address, PoolKey calldata, uint256, uint256, bytes calldata) external override {
        revert("MPM: Not implemented");
    }

    function validateHookAddress(bytes32) external view override returns (bool) {
        return hookAddress != address(0);
    }

    /// @inheritdoc IPoolManager
    function initialize(PoolKey calldata key, uint160 sqrtPriceX96, bytes calldata hookData)
        external
        override
    {
        // Basic implementation for mock: store initialization status and parameters
        bytes32 poolId = keccak256(abi.encode(key)); // Correctly calculate poolId hash
        require(!initializedPools[poolId], "MPM: Pool already initialized");

        initializedPools[poolId] = true;
        initialSqrtPriceX96[poolId] = sqrtPriceX96;
        // Simulate calculating tick from sqrtPriceX96 (can be simplified for mock)
        // For simplicity, let's just use 0 or a fixed value.
        // If tests require a specific tick calculation, this needs refinement.
        // int24 tick = 0; // Placeholder tick value, now a local variable
        int24 tick = TickMath.getTickAtSqrtPrice(sqrtPriceX96); // Corrected function name
        initialTick[poolId] = tick; // Store the mock tick

        // Ensure the actual pool instance is initialized as well
        require(address(pool) != address(0), "MPM: Pool not set");
        pool.initialize(key.token0, key.token1, key.fee);

        // Optionally, call hook if present and has permission
        if (key.hooks != address(0) && Hooks.hasPermission(key.hooks, Hooks.AFTER_INITIALIZE_FLAG)) {
            // Remove the 'tick' argument as BaseHook.afterInitialize expects only 4 arguments
            try BaseHook(key.hooks).afterInitialize(msg.sender, key, sqrtPriceX96, hookData) returns (
                bytes4 selector
            ) {
                require(selector == BaseHook.afterInitialize.selector, "MPM: Invalid afterInitialize hook selector");
            } catch Error(string memory reason) {
                // Handle or log hook error if necessary for testing
                revert(reason);
            }
        }
        // No revert needed here as we are implementing the function
    }

    function getPool(PoolKey calldata key) external view override returns (Pool memory) {
        require(key.token0 == pool.token0() && key.token1 == pool.token1(), "MPM: Pool not found");
        return Pool({token0: pool.token0(), token1: pool.token1(), fee: 3000, tickSpacing: 60, hooks: hookAddress});
    }
}
