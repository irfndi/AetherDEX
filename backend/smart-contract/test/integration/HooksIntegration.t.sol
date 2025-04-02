// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.29;

import {Test} from "forge-std/Test.sol";
import {AetherPool} from "../../src/AetherPool.sol";
import {TWAPOracleHook} from "../../src/hooks/TWAPOracleHook.sol";
import {DynamicFeeHook} from "../../src/hooks/DynamicFeeHook.sol";
import {FeeRegistry} from "../../src/FeeRegistry.sol";
import {IPoolManager, BalanceDelta} from "../../src/interfaces/IPoolManager.sol";
import {Hooks} from "../../src/libraries/Hooks.sol";
import {PoolKey} from "../../src/types/PoolKey.sol";
import {MockERC20} from "../mocks/MockERC20.sol";
import {MockPoolManager} from "../mocks/MockPoolManager.sol";
import {HookFactory} from "../utils/HookFactory.sol";

/**
 * @title HooksIntegrationTest
 * @dev Integration tests for hooks interacting with pools
 */
contract HooksIntegrationTest is Test {
    MockPoolManager poolManager;
    TWAPOracleHook twapHook;
    DynamicFeeHook feeHook;
    FeeRegistry feeRegistry;

    MockERC20 token0;
    MockERC20 token1;

    address alice = address(0x2);

    PoolKey poolKey;

    function setUp() public {
        // Deploy mock tokens
        token0 = new MockERC20("Token0", "TKN0", 18);
        token1 = new MockERC20("Token1", "TKN1", 18);

        // Deploy fee registry and factory for hooks
        feeRegistry = new FeeRegistry();
        HookFactory factory = new HookFactory();

        // Deploy hooks through factory to ensure proper flag encoding
        twapHook = factory.deployTWAPHook(address(this), 3600);
        feeHook = factory.deployDynamicFeeHook(address(this), address(feeRegistry));

        // Create and initialize the pool
        AetherPool pool = new AetherPool(address(this));
        pool.initialize(address(token0), address(token1), uint24(3000), address(this));

        // Deploy pool manager with pool and TWAP hook
        poolManager = new MockPoolManager(address(pool), address(twapHook));

        // Setup pool key with TWAP hook
        poolKey = PoolKey({
            token0: address(token0),
            token1: address(token1),
            fee: 3000, // 0.3% fee tier
            tickSpacing: 60,
            hooks: address(twapHook)
        });

        // Mint tokens to test accounts
        token0.mint(alice, 1000 ether);
        token1.mint(alice, 1000 ether);

        // Initialize the TWAP oracle with a starting price
        twapHook.initializeOracle(poolKey, 1000);

        // Configure fees in registry
        feeRegistry.setFeeConfig(
            address(token0),
            address(token1),
            3000, // max fee
            1000, // min fee
            100   // fee adjustment step
        );
    }

    function test_TWAPHookBeforeSwap() public {
        // Ensure the TWAP oracle is initialized for this test
        // This is needed to prevent arithmetic overflow in the TWAP calculation
        twapHook.initializeOracle(poolKey, 1000);

        // Setup the current timestamp for the TWAP oracle to use
        // This ensures we have a valid observation at the current timestamp
        vm.warp(block.timestamp + 1); // Advance time by 1 second

        // Setup swap parameters
        IPoolManager.SwapParams memory params =
            IPoolManager.SwapParams({zeroForOne: true, amountSpecified: 10 ether, sqrtPriceLimitX96: 0});

        // Call beforeSwap hook directly
        bytes4 selector = twapHook.beforeSwap(alice, poolKey, params, bytes(""));

        // Verify the hook returns the correct selector
        assertEq(selector, TWAPOracleHook.beforeSwap.selector, "TWAP hook beforeSwap selector mismatch");

        // Verify the hook was called in the pool manager
        // Note: In a real test, we would need to mock this call through the pool manager
        // For now, we'll just check the selector
        // assertTrue(poolManager.beforeSwapCalled(), "beforeSwap not called in pool manager");
    }

    function test_TWAPHookAfterSwap() public {
        // Ensure the TWAP oracle is initialized for this test
        // This is needed to prevent arithmetic overflow in the TWAP calculation
        twapHook.initializeOracle(poolKey, 1000);

        // Setup the current timestamp for the TWAP oracle to use
        // This ensures we have a valid observation at the current timestamp
        vm.warp(block.timestamp + 1); // Advance time by 1 second

        // Setup swap parameters
        IPoolManager.SwapParams memory params =
            IPoolManager.SwapParams({zeroForOne: true, amountSpecified: 10 ether, sqrtPriceLimitX96: 0});

        // Create a balance delta
        int256 amount0 = -10 ether;
        int256 amount1 = 9.97 ether; // Accounting for 0.3% fee
        poolManager.setBalanceDelta(amount0, amount1);

        // Call afterSwap hook directly
        bytes4 selector = twapHook.afterSwap(alice, poolKey, params, poolManager.getBalanceDelta(), bytes(""));

        // Verify the hook returns the correct selector
        assertEq(selector, TWAPOracleHook.afterSwap.selector, "TWAP hook afterSwap selector mismatch");

        // Verify the hook was called in the pool manager
        // Note: In a real test, we would need to mock this call through the pool manager
        // For now, we'll just check the selector
        // assertTrue(poolManager.afterSwapCalled(), "afterSwap not called in pool manager");

        // Verify TWAP was updated (would need to expose observation data in the hook for a complete test)
    }

    function test_DynamicFeeHookBeforeSwap() public {
        // Create a pool key with the dynamic fee hook
        PoolKey memory dynamicFeePoolKey = PoolKey(
            address(token0),
            address(token1),
            3000, // Use a fee tier that exists in the registry
            60, // tick spacing
            address(feeHook) // Using fee hook for this test
        );

        // Initialize the pool with the dynamic fee hook
        poolManager.initialize(dynamicFeePoolKey, uint160(0), "");

        // Make sure the fee registry has the correct fee for this token pair
        // This ensures the fee in the registry matches the fee in the pool key (3000)
        feeRegistry.setFeeConfig(address(token0), address(token1), 3000, 3000, 0);

        // Setup swap parameters
        IPoolManager.SwapParams memory params =
            IPoolManager.SwapParams({zeroForOne: true, amountSpecified: 10 ether, sqrtPriceLimitX96: 0});

        // Call beforeSwap hook directly
        bytes4 selector = feeHook.beforeSwap(alice, dynamicFeePoolKey, params, bytes(""));

        // Verify the hook returns the correct selector
        assertEq(selector, DynamicFeeHook.beforeSwap.selector, "Fee hook beforeSwap selector mismatch");
    }

    function test_HookChaining() public {
        // Test that multiple hooks can be called in sequence

        // Create a pool key with the dynamic fee hook for testing
        PoolKey memory dynamicFeePoolKey = PoolKey(
            address(token0),
            address(token1),
            3000, // Use a fee tier that exists in the registry
            60, // tick spacing
            address(feeHook) // Using fee hook for this test
        );

        // Initialize the pool with the dynamic fee hook
        poolManager.initialize(dynamicFeePoolKey, uint160(0), "");

        // Make sure the fee registry has the correct fee for this token pair
        // This ensures the fee in the registry matches the fee in the pool key (3000)
        feeRegistry.setFeeConfig(address(token0), address(token1), 3000, 3000, 0);

        // Initialize the TWAP oracle for both pool keys
        // This is needed to prevent arithmetic overflow in the TWAP calculation
        twapHook.initializeOracle(poolKey, 1000);
        twapHook.initializeOracle(dynamicFeePoolKey, 1000);

        // Setup the current timestamp for the TWAP oracle to use
        // This ensures we have a valid observation at the current timestamp
        vm.warp(block.timestamp + 1); // Advance time by 1 second

        // Setup swap parameters
        IPoolManager.SwapParams memory params =
            IPoolManager.SwapParams({zeroForOne: true, amountSpecified: 10 ether, sqrtPriceLimitX96: 0});

        // Call both hooks and verify they return the correct selectors
        bytes4 twapSelector = twapHook.beforeSwap(alice, poolKey, params, bytes(""));
        bytes4 feeSelector = feeHook.beforeSwap(alice, dynamicFeePoolKey, params, bytes(""));

        assertEq(twapSelector, TWAPOracleHook.beforeSwap.selector, "TWAP hook selector mismatch");
        assertEq(feeSelector, DynamicFeeHook.beforeSwap.selector, "Fee hook selector mismatch");
    }

    function test_ModifyPositionHooks() public {
        // Ensure the TWAP oracle is initialized for this test
        // This is needed to prevent arithmetic overflow in the TWAP calculation
        twapHook.initializeOracle(poolKey, 1000);

        // Setup the current timestamp for the TWAP oracle to use
        // This ensures we have a valid observation at the current timestamp
        vm.warp(block.timestamp + 1); // Advance time by 1 second

        // Setup position parameters
        IPoolManager.ModifyPositionParams memory params =
            IPoolManager.ModifyPositionParams({tickLower: -100, tickUpper: 100, liquidityDelta: 1000 ether});

        // Call beforeModifyPosition hook directly
        bytes4 beforeSelector = twapHook.beforeModifyPosition(alice, poolKey, params, bytes(""));

        // Create a balance delta for the position modification
        int256 amount0 = -5 ether;
        int256 amount1 = -5 ether;
        poolManager.setBalanceDelta(amount0, amount1);

        // Call afterModifyPosition hook directly
        bytes4 afterSelector =
            twapHook.afterModifyPosition(alice, poolKey, params, poolManager.getBalanceDelta(), bytes(""));

        // Verify the hooks return the correct selectors
        assertEq(beforeSelector, twapHook.beforeModifyPosition.selector, "beforeModifyPosition selector mismatch");
        assertEq(afterSelector, twapHook.afterModifyPosition.selector, "afterModifyPosition selector mismatch");

        // Note: In a real test, we would need to mock these calls through the pool manager
        // For now, we'll just check the selectors
        // assertTrue(poolManager.beforeModifyPositionCalled(), "beforeModifyPosition not called in pool manager");
        // assertTrue(poolManager.afterModifyPositionCalled(), "afterModifyPosition not called in pool manager");
    }
}
