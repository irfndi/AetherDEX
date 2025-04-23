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

    function swap(PoolKey calldata key, SwapParams calldata params, bytes calldata hookData)
        external
        override
        returns (BalanceDelta memory delta)
    {
        // Validate key
        _validateKey(key);

        // Handle pre-swap hook
        _handleBeforeSwapHook(key, params, hookData);

        // --- Execute Swap on the actual pool ---
        address poolAddress = pools[keccak256(abi.encode(key))];
        require(poolAddress != address(0), "MPM: Pool not found for swap");
        AetherPool targetPool = AetherPool(poolAddress);

        // Determine tokenIn and amountIn
        address tokenIn = params.zeroForOne ? key.token0 : key.token1;
        uint256 amountIn = uint256(params.amountSpecified);
        require(amountIn > 0, "MPM: Invalid swap amount");

        // 1. Transfer tokenIn from original caller (msg.sender) to this mock manager
        // Note: The caller (test contract) must have approved this mock manager beforehand.
        TransferHelper.safeTransferFrom(tokenIn, msg.sender, address(this), amountIn);

        // 2. Approve the actual pool to take tokenIn from this mock manager
        IERC20(tokenIn).approve(poolAddress, amountIn);

        // 3. Call the actual pool's swap function (manager is msg.sender for the pool)
        // The pool will pull tokenIn from this manager contract and send tokenOut to msg.sender (original caller).
        uint256 amountOut = targetPool.swap(amountIn, tokenIn, msg.sender); // Call actual swap

        // 4. Calculate BalanceDelta based on actual in/out (Pool's Perspective)
        int256 amount0Change;
        int256 amount1Change;
        if (params.zeroForOne) { // Pool receives token0 (amountIn), sends token1 (amountOut)
            amount0Change = int256(amountIn);      // Positive: Pool received token0
            amount1Change = -int256(amountOut);    // Negative: Pool sent token1
        } else { // Pool receives token1 (amountIn), sends token0 (amountOut)
            amount1Change = int256(amountIn);      // Positive: Pool received token1
            amount0Change = -int256(amountOut);    // Negative: Pool sent token0
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
        AetherPool targetPool = AetherPool(poolAddress);
        require(key.token0 == targetPool.token0(), "MPM: Invalid token0");
        require(key.token1 == targetPool.token1(), "MPM: Invalid token1");
        // Hook validation remains the same, assuming hookAddress is global for the mock
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
    function modifyPosition(PoolKey calldata key, ModifyPositionParams calldata params, bytes calldata /* hookData */ )
        external
        override
        returns (BalanceDelta memory delta)
    {
        address poolAddress = _validateKey(key); // Get pool address while validating
        AetherPool targetPool = AetherPool(poolAddress); // Get pool instance

        // Call the actual pool's mint or burn function
        if (params.liquidityDelta > 0) {
            // For mint, we need amounts. This mock can't calculate them from ticks.
            // We'll revert here as the mock is insufficient for realistic mint testing via manager.
            // Tests should call pool.mint directly or use a more sophisticated mock/integration test.
            revert("MPM: Mock modifyPosition cannot calculate mint amounts. Call pool.mint directly.");
            // If we *did* calculate amounts (e.g., amount0, amount1):
            // uint256 liquidityOut = targetPool.mint(msg.sender, amount0, amount1);
            // delta = BalanceDelta(int256(amount0), int256(amount1)); // Positive delta for manager receiving tokens
        } else if (params.liquidityDelta < 0) {
            uint256 liquidityToRemove = uint256(-params.liquidityDelta);
            (uint256 amount0Out, uint256 amount1Out) = targetPool.burn(msg.sender, liquidityToRemove);
            // Return negative delta indicating tokens sent from the pool
            delta = BalanceDelta(-int256(amount0Out), -int256(amount1Out));
        } else {
            // liquidityDelta is zero, return zero delta
            delta = BalanceDelta(0, 0);
            // Revert if liquidityDelta is zero, as per V4 core behavior
            revert("LiquidityDelta=0");
        }
    }

    // Marked as pure as they only revert
    function donate(PoolKey calldata, uint256, uint256, bytes calldata) external pure override {
        revert("MPM: Not implemented");
    }

    // Marked as pure as they only revert
    function take(PoolKey calldata, address, uint256, uint256, bytes calldata) external pure override {
        revert("MPM: Not implemented");
    }

    // Marked as pure as they only revert
    function settle(address) external pure override returns (BalanceDelta memory, BalanceDelta memory) {
        revert("MPM: Not implemented");
    }

    // Marked as pure as they only revert
    function mint(address, PoolKey calldata, uint256, uint256, bytes calldata) external pure override {
        revert("MPM: Not implemented");
    }

    // Marked as pure as they only revert
    function burn(address, PoolKey calldata, uint256, uint256, bytes calldata) external pure override {
        revert("MPM: Not implemented");
    }

    function validateHookAddress(bytes32) external view override returns (bool) {
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
        AetherPool targetPool = AetherPool(poolAddress); // Get pool instance
        targetPool.initialize(key.token0, key.token1, key.fee);

        // Optionally, call hook if present and has permission
        if (key.hooks != address(0) && Hooks.hasPermission(key.hooks, Hooks.AFTER_INITIALIZE_FLAG)) {
            // Remove the 'tick' argument as BaseHook.afterInitialize expects only 4 arguments
            try BaseHook(key.hooks).afterInitialize(msg.sender, key, sqrtPriceX96, hookData) returns (bytes4 selector) {
                require(selector == BaseHook.afterInitialize.selector, "MPM: Invalid afterInitialize hook selector");
            } catch Error(string memory reason) {
                // Handle or log hook error if necessary for testing
                revert(reason);
            }
        }
        // No revert needed here as we are implementing the function
    }

    // Get pool info based on the key, retrieving from the mapping
    function getPool(PoolKey calldata key) external view override returns (Pool memory) {
        bytes32 poolId = keccak256(abi.encode(key));
        address poolAddress = pools[poolId];
        require(poolAddress != address(0), "MPM: Pool not found for key");
        AetherPool targetPool = AetherPool(poolAddress);
        // Return info based on the specific pool found
        return Pool({
            token0: targetPool.token0(),
            token1: targetPool.token1(),
            fee: targetPool.fee(), // Get fee from the actual pool instance
            tickSpacing: 60, // Assuming fixed tick spacing for mock, adjust if needed
            hooks: hookAddress // Assuming global hook address for mock
        });
    }
}
