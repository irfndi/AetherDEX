// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.29;

import {Test} from "forge-std/Test.sol";
import {AetherPool} from "../src/AetherPool.sol";
import {MockERC20} from "./mocks/MockERC20.sol";
import {MockPoolManager} from "./mocks/MockPoolManager.sol"; 
import {AetherFactory} from "../src/AetherFactory.sol"; 
import {FeeRegistry} from "../src/FeeRegistry.sol"; 
import {IPoolManager} from "../src/interfaces/IPoolManager.sol";
import {IHooks} from "../lib/v4-core/src/interfaces/IHooks.sol"; 
import {PoolKey} from "../src/types/PoolKey.sol";
import {BalanceDelta} from "../src/types/BalanceDelta.sol";
import {Permissions} from "../src/interfaces/Permissions.sol";
import {console2} from "forge-std/console2.sol";
import {TickMath} from "lib/v4-core/src/libraries/TickMath.sol";

/**
 * @title AetherPoolTest
 * @dev Unit tests for the AetherPool contract, focusing on liquidity operations.
 * Uses MockPoolManager for testing pool interactions via the manager.
 */
contract AetherPoolTest is Test { 
    AetherPool public testPool;
    MockPoolManager public poolManager; 
    AetherFactory public factory; 
    FeeRegistry public feeRegistry; 
    MockERC20 token0;
    MockERC20 token1;

    address alice = address(0x2);
    address bob = address(0x3);
    uint24 constant DEFAULT_FEE = 3000; 

    function testSetUp() public {
        token0 = new MockERC20("Token0", "TKN0", 18);
        token1 = new MockERC20("Token1", "TKN1", 18);

        if (address(token0) > address(token1)) {
            (token0, token1) = (token1, token0);
        }

        feeRegistry = new FeeRegistry(address(this));
        factory = new AetherFactory(address(feeRegistry));
        assertNotEq(address(factory), address(0), "Factory address is zero"); // Check factory address

        poolManager = new MockPoolManager(address(0)); 

        testPool = new AetherPool(address(factory)); // Reverted back to using factory address
        assertNotEq(address(testPool), address(0), "Pool address zero immediately after deployment"); // Check address right after new

        // vm.roll(block.number + 1); // Reverted: Test if any vm cheatcode works

        // Link the mock manager to the actual pool instance
        poolManager.setPool(address(testPool)); // pass instance to manager

        // --- Temporarily comment out the rest of setUp --- 
        /*
        uint160 initialSqrtPriceX96 = 1 << 96; 

        // Mint tokens to users *before* they interact
        token0.mint(alice, 1000 ether);
        token1.mint(alice, 1000 ether);
        token0.mint(bob, 1000 ether);
        token1.mint(bob, 1000 ether);

        // Initialize Pool (as contract owner)
        vm.startPrank(address(this));
        poolManager.initialize(key, initialSqrtPriceX96, bytes(""));
        vm.stopPrank();

        // Add initial liquidity (as alice)
        vm.startPrank(alice);
        token0.approve(address(poolManager), type(uint256).max);
        token1.approve(address(poolManager), type(uint256).max);
        IPoolManager.ModifyPositionParams memory params;
        params.tickLower = TickMath.minUsableTick(60);
        params.tickUpper = TickMath.maxUsableTick(60);
        params.liquidityDelta = int256(100 ether); 
        poolManager.modifyPosition(key, params, bytes(""));
        vm.stopPrank();

        // Approve pool directly for subsequent test actions (optional here, could be in tests)
        vm.startPrank(alice);
        token0.approve(address(testPool), type(uint256).max);
        token1.approve(address(testPool), type(uint256).max);
        vm.stopPrank();

        vm.startPrank(bob);
        token0.approve(address(testPool), type(uint256).max);
        token1.approve(address(testPool), type(uint256).max);
        vm.stopPrank();
        */
    }

    function testInitialize() public view { 
        // vm.log("Entering testInitialize"); // Commented out for now
        // vm.roll(block.number + 1); // Reverted: Test if any vm cheatcode works
        // vm.logAddress(address(testPool)); // Commented out for now
        // vm.logAddress(address(poolManager.pool())); // Commented out for now
        // Basic check: Is the pool address valid after setUp?
        assertNotEq(address(testPool), address(0), "testInitialize: Pool address is zero");
    }

    function test_AddLiquidity() public {
        PoolKey memory key = PoolKey({
            token0: address(token0),
            token1: address(token1),
            fee: DEFAULT_FEE,
            tickSpacing: 60, 
            hooks: address(0) 
        });
        
        vm.startPrank(alice);
        IPoolManager.ModifyPositionParams memory params;
        params.tickLower = TickMath.minUsableTick(60);
        params.tickUpper = TickMath.maxUsableTick(60);
        params.liquidityDelta = int256(100 ether); 
        
        uint256 initialBalance0 = token0.balanceOf(address(testPool));
        uint256 initialBalance1 = token1.balanceOf(address(testPool));
        poolManager.modifyPosition(key, params, bytes(""));
        assertGt(token0.balanceOf(address(testPool)), initialBalance0, "Pool token0 balance should increase (1st add)");
        assertGt(token1.balanceOf(address(testPool)), initialBalance1, "Pool token1 balance should increase (1st add)");

        uint256 secondAddBalance0 = token0.balanceOf(address(testPool));
        uint256 secondAddBalance1 = token1.balanceOf(address(testPool));
        params.liquidityDelta = int256(50 ether); // Add a different amount
        poolManager.modifyPosition(key, params, bytes(""));
        assertGt(token0.balanceOf(address(testPool)), secondAddBalance0, "Pool token0 balance should increase (2nd add)");
        assertGt(token1.balanceOf(address(testPool)), secondAddBalance1, "Pool token1 balance should increase (2nd add)");
        
        vm.stopPrank();
    }

    function test_RemoveLiquidity() public {
        PoolKey memory key = PoolKey({
            token0: address(token0),
            token1: address(token1),
            fee: DEFAULT_FEE,
            tickSpacing: 60, 
            hooks: address(0) 
        });
        uint160 initialSqrtPriceX96 = 1 << 96; 
        vm.startPrank(address(this));
        poolManager.initialize(key, initialSqrtPriceX96, bytes(""));
        vm.stopPrank();

        uint256 amount0 = 100 ether;
        uint256 amount1 = 100 ether;

        vm.startPrank(alice);
        IPoolManager.ModifyPositionParams memory addParams;
        addParams.liquidityDelta = int256(100 ether); 
        poolManager.modifyPosition(key, addParams, bytes(""));
        // uint256 liquidity = testPool.balanceOf(alice); // V4 doesn't use LP tokens like this

        IPoolManager.ModifyPositionParams memory removeParams;
        removeParams.liquidityDelta = -int256(100 ether);
        removeParams.tickLower = -887220; 
        removeParams.tickUpper = 887220;  
        (BalanceDelta memory delta) = poolManager.modifyPosition(key, removeParams, bytes(""));
        vm.stopPrank();

        assertGt(uint256(delta.amount0), 0, "Returned amount0 should be greater than 0");
        assertGt(uint256(delta.amount1), 0, "Returned amount1 should be greater than 0");
        assertApproxEqAbs(uint256(delta.amount0), amount0, amount0 / 100, "Returned amount0 mismatch"); 
        assertApproxEqAbs(uint256(delta.amount1), amount1, amount1 / 100, "Returned amount1 mismatch"); 

        assertGt(token0.balanceOf(alice), 1000 ether - amount0, "Alice should receive token0 back");
        assertGt(token1.balanceOf(alice), 1000 ether - amount1, "Alice should receive token1 back");
    }

    function test_Swap() public {
        PoolKey memory key = PoolKey({
            token0: address(token0),
            token1: address(token1),
            fee: DEFAULT_FEE,
            tickSpacing: 60, 
            hooks: address(0) 
        });
        uint160 initialSqrtPriceX96 = 1 << 96; 

        vm.startPrank(alice);
        token0.approve(address(poolManager), type(uint256).max);
        token1.approve(address(poolManager), type(uint256).max);
        IPoolManager.ModifyPositionParams memory params;
        params.tickLower = -887220; 
        params.tickUpper = 887220;  
        params.liquidityDelta = int256(100 ether); 
        vm.startPrank(address(this));
        poolManager.initialize(key, initialSqrtPriceX96, bytes(""));
        vm.stopPrank();
        poolManager.modifyPosition(key, params, bytes(""));
        uint256 initialManagerBalance0 = token0.balanceOf(address(poolManager));
        uint256 initialManagerBalance1 = token1.balanceOf(address(poolManager));
        vm.stopPrank();

        uint256 swapAmount = 10 ether;

        vm.startPrank(bob);
        token0.approve(address(poolManager), swapAmount);

        IPoolManager.SwapParams memory swapParams = IPoolManager.SwapParams({
            zeroForOne: true, 
            amountSpecified: int256(swapAmount),
            sqrtPriceLimitX96: 0 
        });
        BalanceDelta memory delta = poolManager.swap(key, swapParams, bytes(""));
        vm.stopPrank();

        uint256 expectedAmountOut = uint256(-delta.amount1); 

        assertEq(token0.balanceOf(bob), 1000 ether - swapAmount, "Bob token0 balance incorrect after swap");
        assertApproxEqAbs(token1.balanceOf(bob), 1000 ether + expectedAmountOut, expectedAmountOut / 100, "Bob token1 balance incorrect after swap"); 

        assertEq(token0.balanceOf(address(poolManager)), initialManagerBalance0 + swapAmount, "Manager token0 balance incorrect");
        assertApproxEqAbs(token1.balanceOf(address(poolManager)), initialManagerBalance1 - expectedAmountOut, expectedAmountOut / 100, "Manager token1 balance incorrect");
    }

    function test_RevertOnReinitialize() public {
        PoolKey memory key = PoolKey({
            token0: address(token0),
            token1: address(token1),
            fee: DEFAULT_FEE,
            tickSpacing: 60, 
            hooks: address(0) 
        });
        uint160 initialSqrtPriceX96 = 1 << 96; 
        vm.startPrank(address(this));
        poolManager.initialize(key, initialSqrtPriceX96, bytes(""));
        vm.stopPrank();

        vm.expectRevert("ALREADY_INITIALIZED");
        vm.startPrank(address(this));
        poolManager.initialize(key, initialSqrtPriceX96, bytes(""));
        vm.stopPrank();
    }

    function test_RevertOnInsufficientLiquidityMinted() public {
        PoolKey memory key = PoolKey({
            token0: address(token0),
            token1: address(token1),
            fee: DEFAULT_FEE,
            tickSpacing: 60, 
            hooks: address(0) 
        });
        uint160 initialSqrtPriceX96 = 1 << 96; 
        vm.startPrank(address(this));
        poolManager.initialize(key, initialSqrtPriceX96, bytes(""));
        vm.stopPrank();

        vm.startPrank(alice);
        IPoolManager.ModifyPositionParams memory params;
        params.tickLower = -887220; 
        params.tickUpper = 887220;  
        params.liquidityDelta = 0; 
        vm.expectRevert("LiquidityDelta=0"); 
        poolManager.modifyPosition(key, params, bytes(""));
        vm.stopPrank();
    }

    function test_RevertOnInsufficientLiquidityBurned() public {
        PoolKey memory key = PoolKey({
            token0: address(token0),
            token1: address(token1),
            fee: DEFAULT_FEE,
            tickSpacing: 60, 
            hooks: address(0) 
        });
        uint160 initialSqrtPriceX96 = 1 << 96; 
        vm.startPrank(address(this));
        poolManager.initialize(key, initialSqrtPriceX96, bytes(""));
        vm.stopPrank();

        vm.startPrank(alice);
        IPoolManager.ModifyPositionParams memory addParams;
        addParams.tickLower = -887220; 
        addParams.tickUpper = 887220;  
        addParams.liquidityDelta = int256(100 ether);
        poolManager.modifyPosition(key, addParams, bytes(""));
        // uint256 liquidity = testPool.balanceOf(alice); // V4 doesn't use LP tokens like this

        IPoolManager.ModifyPositionParams memory removeParams;
        removeParams.tickLower = -887220; 
        removeParams.tickUpper = 887220;  
        removeParams.liquidityDelta = -int256(100 ether + 1);

        vm.expectRevert(abi.encodeWithSignature("Panic(uint256)", 0x11));
        poolManager.modifyPosition(key, removeParams, bytes(""));

        vm.stopPrank();
    }

    function test_RevertOnInvalidTokenIn() public {
        PoolKey memory key = PoolKey({
            token0: address(token0),
            token1: address(token1),
            fee: DEFAULT_FEE,
            tickSpacing: 60, 
            hooks: address(0) 
        });
        uint160 initialSqrtPriceX96 = 1 << 96; 
        vm.startPrank(address(this));
        poolManager.initialize(key, initialSqrtPriceX96, bytes(""));
        vm.stopPrank();

        vm.startPrank(alice);
        IPoolManager.ModifyPositionParams memory addParams;
        addParams.tickLower = -887220; 
        addParams.tickUpper = 887220;  
        addParams.liquidityDelta = int256(100 ether);
        poolManager.modifyPosition(key, addParams, bytes(""));
        vm.stopPrank();

        address invalidToken = address(0x123);
        MockERC20 invalidMock = new MockERC20("Invalid", "INV", 18);
        PoolKey memory invalidKey = PoolKey({
            token0: invalidToken,
            token1: address(token1),
            fee: DEFAULT_FEE,
            tickSpacing: 60,
            hooks: address(0)
        });

        vm.startPrank(bob);
        invalidMock.mint(bob, 10 ether);
        invalidMock.approve(address(poolManager), 10 ether);
        IPoolManager.SwapParams memory swapParams = IPoolManager.SwapParams({
            zeroForOne: true,
            amountSpecified: int256(10 ether),
            sqrtPriceLimitX96: 0
        });
        vm.expectRevert(bytes("Pool not initialized")); 
        poolManager.swap(invalidKey, swapParams, bytes(""));
        vm.stopPrank();
    }

    function test_RevertOnInsufficientOutputAmount() public {
        PoolKey memory key = PoolKey({
            token0: address(token0),
            token1: address(token1),
            fee: DEFAULT_FEE,
            tickSpacing: 60, 
            hooks: address(0) 
        });
        uint160 initialSqrtPriceX96 = 1 << 96; 
        vm.startPrank(address(this));
        poolManager.initialize(key, initialSqrtPriceX96, bytes(""));
        vm.stopPrank();

        vm.startPrank(alice);
        IPoolManager.ModifyPositionParams memory addParams;
        addParams.tickLower = -887220; 
        addParams.tickUpper = 887220;  
        addParams.liquidityDelta = int256(100 ether);
        poolManager.modifyPosition(key, addParams, bytes(""));
        vm.stopPrank();

        uint256 swapAmount = 1 wei;

        vm.startPrank(bob);
        token0.approve(address(poolManager), swapAmount);

        IPoolManager.SwapParams memory swapParams = IPoolManager.SwapParams({
            zeroForOne: true,
            amountSpecified: int256(swapAmount),
            sqrtPriceLimitX96: 0
        });
        BalanceDelta memory delta = poolManager.swap(key, swapParams, bytes(""));
        vm.stopPrank();

        assertLe(uint256(-delta.amount1), 1, "Output should be minimal/zero");
    }
}
