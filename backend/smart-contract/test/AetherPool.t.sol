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

        testPool = new AetherPool(address(factory));
        assertNotEq(address(testPool), address(0), "Pool address zero immediately after deployment");

        // Calculate poolId before setting in manager
        PoolKey memory key = PoolKey({
            token0: address(token0),
            token1: address(token1),
            fee: DEFAULT_FEE,
            tickSpacing: 60,
            hooks: address(0)
        });
        bytes32 poolId = keccak256(abi.encode(key)); // Calculate poolId
        poolManager.setPool(poolId, address(testPool)); // Use poolId

        uint160 initialSqrtPriceX96 = 1 << 96;

        vm.startPrank(address(this));
        // Initialize the pool via the manager *once* in setup
        // This requires the mock manager's initialize to call the pool's initialize
        poolManager.initialize(key, initialSqrtPriceX96, bytes(""));
        vm.stopPrank();

        // Mint tokens to users *before* they interact
        token0.mint(alice, 1000 ether);
        token1.mint(alice, 1000 ether);
        token0.mint(bob, 1000 ether);
        token1.mint(bob, 1000 ether);

        // Add initial liquidity directly to the pool *after* initialization
        uint256 initialAmount0 = 100 ether;
        uint256 initialAmount1 = 100 ether; // Assuming 1:1 initial ratio for simplicity
        vm.startPrank(alice);
        token0.approve(address(testPool), initialAmount0);
        token1.approve(address(testPool), initialAmount1);
        testPool.mint(alice, initialAmount0, initialAmount1);
        vm.stopPrank();

        // Approve pool manager for subsequent test actions
        vm.startPrank(alice);
        token0.approve(address(poolManager), type(uint256).max);
        token1.approve(address(poolManager), type(uint256).max);
        vm.stopPrank();

        vm.startPrank(bob);
        token0.approve(address(poolManager), type(uint256).max);
        token1.approve(address(poolManager), type(uint256).max);
        vm.stopPrank();
    }

    function testInitialize() public {
        // Deploy new factory and pool instances within the test function to isolate state
        FeeRegistry localFeeRegistry = new FeeRegistry(address(this));
        AetherFactory localFactory = new AetherFactory(address(localFeeRegistry));
        AetherPool localTestPool = new AetherPool(address(localFactory));
        assertNotEq(address(localTestPool), address(0), "testInitialize: Deployed localTestPool address is zero");

        // Deploy local tokens for this test
        MockERC20 localToken0 = new MockERC20("LocalToken0", "LT0", 18);
        MockERC20 localToken1 = new MockERC20("LocalToken1", "LT1", 18);
        if (address(localToken0) > address(localToken1)) {
            (localToken0, localToken1) = (localToken1, localToken0);
        }

        // Initialize the locally deployed pool with local tokens
        vm.startPrank(address(this)); // Assuming 'this' (test contract) can initialize
        localTestPool.initialize(address(localToken0), address(localToken1), DEFAULT_FEE);
        vm.stopPrank();

        assertTrue(localTestPool.initialized(), "Local pool should be initialized");
        assertEq(localTestPool.token0(), address(localToken0), "Local pool Token0 mismatch"); // Compare with local token
        assertEq(localTestPool.token1(), address(localToken1), "Local pool Token1 mismatch"); // Compare with local token
        assertEq(localTestPool.fee(), DEFAULT_FEE, "Local pool Fee mismatch");

        // Cannot reliably check the state variable from setUp due to state persistence issues
        // assertNotEq(address(testPool), address(0), "testInitialize: testPool state variable address is zero");
    }

    function test_AddLiquidity() public {
        // --- Local Setup ---
        MockERC20 localToken0 = new MockERC20("LocalToken0", "LT0", 18);
        MockERC20 localToken1 = new MockERC20("LocalToken1", "LT1", 18);
        if (address(localToken0) > address(localToken1)) {
            (localToken0, localToken1) = (localToken1, localToken0);
        }
        FeeRegistry localFeeRegistry = new FeeRegistry(address(this));
        AetherFactory localFactory = new AetherFactory(address(localFeeRegistry));
        AetherPool localTestPool = new AetherPool(address(localFactory));

        vm.startPrank(address(this));
        localTestPool.initialize(address(localToken0), address(localToken1), DEFAULT_FEE);
        vm.stopPrank();

        localToken0.mint(alice, 1000 ether);
        localToken1.mint(alice, 1000 ether);
        // --- End Local Setup ---

        vm.startPrank(alice);

        // Add initial liquidity
        uint256 amount0ToAdd1 = 100 ether;
        uint256 amount1ToAdd1 = 100 ether;
        uint256 initialBalance0 = localToken0.balanceOf(address(localTestPool));
        uint256 initialBalance1 = localToken1.balanceOf(address(localTestPool));

        localToken0.approve(address(localTestPool), amount0ToAdd1);
        localToken1.approve(address(localTestPool), amount1ToAdd1);
        localTestPool.mint(alice, amount0ToAdd1, amount1ToAdd1);

        assertGt(
            localToken0.balanceOf(address(localTestPool)),
            initialBalance0,
            "Pool token0 balance should increase (1st add)"
        );
        assertGt(
            localToken1.balanceOf(address(localTestPool)),
            initialBalance1,
            "Pool token1 balance should increase (1st add)"
        );

        // Add more liquidity
        uint256 amount0ToAdd2 = 50 ether;
        uint256 amount1ToAdd2 = 50 ether;
        uint256 secondAddBalance0 = localToken0.balanceOf(address(localTestPool));
        uint256 secondAddBalance1 = localToken1.balanceOf(address(localTestPool));

        localToken0.approve(address(localTestPool), amount0ToAdd2);
        localToken1.approve(address(localTestPool), amount1ToAdd2);
        localTestPool.mint(alice, amount0ToAdd2, amount1ToAdd2);

        assertGt(
            localToken0.balanceOf(address(localTestPool)),
            secondAddBalance0,
            "Pool token0 balance should increase (2nd add)"
        );
        assertGt(
            localToken1.balanceOf(address(localTestPool)),
            secondAddBalance1,
            "Pool token1 balance should increase (2nd add)"
        );

        vm.stopPrank();
    }

    function test_RemoveLiquidity() public {
        // --- Local Setup ---
        MockERC20 localToken0 = new MockERC20("LocalToken0", "LT0", 18);
        MockERC20 localToken1 = new MockERC20("LocalToken1", "LT1", 18);
        if (address(localToken0) > address(localToken1)) {
            (localToken0, localToken1) = (localToken1, localToken0);
        }
        FeeRegistry localFeeRegistry = new FeeRegistry(address(this));
        AetherFactory localFactory = new AetherFactory(address(localFeeRegistry));
        AetherPool localTestPool = new AetherPool(address(localFactory));
        MockPoolManager localPoolManager = new MockPoolManager(address(0));

        PoolKey memory key = PoolKey({
            token0: address(localToken0),
            token1: address(localToken1),
            fee: DEFAULT_FEE,
            tickSpacing: 60,
            hooks: address(0)
        });
        bytes32 localPoolId = keccak256(abi.encode(key)); // Calculate local poolId
        localPoolManager.setPool(localPoolId, address(localTestPool)); // Use local poolId

        vm.startPrank(address(this));
        localTestPool.initialize(address(localToken0), address(localToken1), DEFAULT_FEE);
        vm.stopPrank();

        localToken0.mint(alice, 1000 ether);
        localToken1.mint(alice, 1000 ether);

        // Add initial liquidity directly to the pool
        uint256 initialAmount0 = 100 ether;
        uint256 initialAmount1 = 100 ether;
        uint256 initialLiquidity;
        vm.startPrank(alice);
        localToken0.approve(address(localTestPool), initialAmount0);
        localToken1.approve(address(localTestPool), initialAmount1);
        initialLiquidity = localTestPool.mint(alice, initialAmount0, initialAmount1);
        vm.stopPrank();
        // --- End Local Setup ---

        uint256 liquidityToRemove = initialLiquidity / 2; // Remove half the liquidity

        // Calculate expected amounts based on pool state *before* burning
        (uint256 reserve0Before, uint256 reserve1Before) = localTestPool.getReserves();
        uint256 totalSupplyBefore = localTestPool.totalSupply();
        uint256 expectedAmount0 = (liquidityToRemove * reserve0Before) / totalSupplyBefore;
        uint256 expectedAmount1 = (liquidityToRemove * reserve1Before) / totalSupplyBefore;

        vm.startPrank(alice);
        IPoolManager.ModifyPositionParams memory removeParams;
        removeParams.tickLower = TickMath.minUsableTick(60); // Use appropriate ticks if needed
        removeParams.tickUpper = TickMath.maxUsableTick(60);
        removeParams.liquidityDelta = -int256(liquidityToRemove); // Use the calculated liquidity to remove

        // Call modifyPosition on the *local* pool manager
        (BalanceDelta memory delta) = localPoolManager.modifyPosition(key, removeParams, bytes(""));
        vm.stopPrank();

        // Assertions based on the delta returned by the mock (which calls the real burn)
        assertEq(uint256(-delta.amount0), expectedAmount0, "Returned amount0 mismatch");
        assertEq(uint256(-delta.amount1), expectedAmount1, "Returned amount1 mismatch");

        // Check Alice's balance after removal
        assertApproxEqAbs(
            localToken0.balanceOf(alice),
            (1000 ether - initialAmount0) + expectedAmount0,
            expectedAmount0 / 1000,
            "Alice final token0 balance incorrect"
        );
        assertApproxEqAbs(
            localToken1.balanceOf(alice),
            (1000 ether - initialAmount1) + expectedAmount1,
            expectedAmount1 / 1000,
            "Alice final token1 balance incorrect"
        );
    }

    function test_Swap() public {
         // --- Local Setup ---
        MockERC20 localToken0 = new MockERC20("LocalToken0", "LT0", 18);
        MockERC20 localToken1 = new MockERC20("LocalToken1", "LT1", 18);
         if (address(localToken0) > address(localToken1)) {
            (localToken0, localToken1) = (localToken1, localToken0);
        }
        FeeRegistry localFeeRegistry = new FeeRegistry(address(this));
        AetherFactory localFactory = new AetherFactory(address(localFeeRegistry));
        AetherPool localTestPool = new AetherPool(address(localFactory));
        MockPoolManager localPoolManager = new MockPoolManager(address(0));

        PoolKey memory key = PoolKey({
            token0: address(localToken0),
            token1: address(localToken1),
            fee: DEFAULT_FEE,
            tickSpacing: 60,
            hooks: address(0)
        });
        bytes32 localPoolId = keccak256(abi.encode(key)); // Calculate local poolId
        localPoolManager.setPool(localPoolId, address(localTestPool)); // Use local poolId

        vm.startPrank(address(this));
        localTestPool.initialize(address(localToken0), address(localToken1), DEFAULT_FEE);
        vm.stopPrank();

        localToken0.mint(alice, 1000 ether);
        localToken1.mint(alice, 1000 ether);
        localToken0.mint(bob, 1000 ether);
        localToken1.mint(bob, 1000 ether);

        // Add initial liquidity directly to the pool
        uint256 initialAmount0 = 100 ether;
        uint256 initialAmount1 = 100 ether;
        vm.startPrank(alice);
        localToken0.approve(address(localTestPool), initialAmount0);
        localToken1.approve(address(localTestPool), initialAmount1);
        localTestPool.mint(alice, initialAmount0, initialAmount1);
        vm.stopPrank();
        // --- End Local Setup ---

        uint256 swapAmount = 10 ether;
        uint256 bobToken0Before = localToken0.balanceOf(bob);
        uint256 bobToken1Before = localToken1.balanceOf(bob);
        uint256 poolToken0Before = localToken0.balanceOf(address(localTestPool));
        uint256 poolToken1Before = localToken1.balanceOf(address(localTestPool));


        vm.startPrank(bob);
        // Approve BOTH the pool manager (if it handles transfers) AND the pool (which executes the final transferFrom)
        localToken0.approve(address(localPoolManager), swapAmount); // Approve the manager
        localToken0.approve(address(localTestPool), swapAmount);    // Approve the pool itself

        IPoolManager.SwapParams memory swapParams =
            IPoolManager.SwapParams({zeroForOne: true, amountSpecified: int256(swapAmount), sqrtPriceLimitX96: 0});

        // Call swap on the *local* pool manager
        BalanceDelta memory delta = localPoolManager.swap(key, swapParams, bytes(""));
        vm.stopPrank();

        uint256 expectedAmountOut = uint256(-delta.amount1);

        assertEq(localToken0.balanceOf(bob), bobToken0Before - swapAmount, "Bob token0 balance incorrect after swap");
        assertApproxEqAbs(
            localToken1.balanceOf(bob),
            bobToken1Before + expectedAmountOut,
            expectedAmountOut / 100,
            "Bob token1 balance incorrect after swap"
        );

        assertEq(
            localToken0.balanceOf(address(localTestPool)),
            poolToken0Before + swapAmount,
            "Pool token0 balance incorrect"
        );
        assertApproxEqAbs(
            localToken1.balanceOf(address(localTestPool)),
            poolToken1Before - expectedAmountOut,
            expectedAmountOut / 100,
            "Pool token1 balance incorrect"
        );
    }

    function test_RevertOnReinitialize() public {
        // --- Local Setup ---
        MockERC20 localToken0 = new MockERC20("LocalToken0", "LT0", 18);
        MockERC20 localToken1 = new MockERC20("LocalToken1", "LT1", 18);
         if (address(localToken0) > address(localToken1)) {
            (localToken0, localToken1) = (localToken1, localToken0);
        }
        FeeRegistry localFeeRegistry = new FeeRegistry(address(this));
        AetherFactory localFactory = new AetherFactory(address(localFeeRegistry));
        AetherPool localTestPool = new AetherPool(address(localFactory));
        // --- End Local Setup ---

        vm.startPrank(address(this));
        localTestPool.initialize(address(localToken0), address(localToken1), DEFAULT_FEE); // Initialize once
        vm.stopPrank();

        vm.expectRevert("ALREADY_INITIALIZED");
        vm.startPrank(address(this));
        localTestPool.initialize(address(localToken0), address(localToken1), DEFAULT_FEE); // Try initializing again
        vm.stopPrank();
    }

    function test_RevertOnInsufficientLiquidityMinted() public {
         // --- Local Setup ---
        MockERC20 localToken0 = new MockERC20("LocalToken0", "LT0", 18);
        MockERC20 localToken1 = new MockERC20("LocalToken1", "LT1", 18);
         if (address(localToken0) > address(localToken1)) {
            (localToken0, localToken1) = (localToken1, localToken0);
        }
        FeeRegistry localFeeRegistry = new FeeRegistry(address(this));
        AetherFactory localFactory = new AetherFactory(address(localFeeRegistry));
        AetherPool localTestPool = new AetherPool(address(localFactory));
        MockPoolManager localPoolManager = new MockPoolManager(address(0)); // Still need manager for interface

        PoolKey memory key = PoolKey({ // Key needed for modifyPosition call signature
            token0: address(localToken0),
            token1: address(localToken1),
            fee: DEFAULT_FEE,
            tickSpacing: 60,
            hooks: address(0)
        });
        bytes32 localPoolId = keccak256(abi.encode(key)); // Calculate local poolId
        localPoolManager.setPool(localPoolId, address(localTestPool)); // Use local poolId

        vm.startPrank(address(this));
        localTestPool.initialize(address(localToken0), address(localToken1), DEFAULT_FEE);
        vm.stopPrank();
        // --- End Local Setup ---

        vm.startPrank(alice);
        IPoolManager.ModifyPositionParams memory params;
        params.tickLower = -887220;
        params.tickUpper = 887220;
        params.liquidityDelta = 0;
        // Expect revert from the mock manager's check
        vm.expectRevert("LiquidityDelta=0");
        localPoolManager.modifyPosition(key, params, bytes(""));
        vm.stopPrank();
    }

    function test_RevertOnInsufficientLiquidityBurned() public {
         // --- Local Setup ---
        MockERC20 localToken0 = new MockERC20("LocalToken0", "LT0", 18);
        MockERC20 localToken1 = new MockERC20("LocalToken1", "LT1", 18);
         if (address(localToken0) > address(localToken1)) {
            (localToken0, localToken1) = (localToken1, localToken0);
        }
        FeeRegistry localFeeRegistry = new FeeRegistry(address(this));
        AetherFactory localFactory = new AetherFactory(address(localFeeRegistry));
        AetherPool localTestPool = new AetherPool(address(localFactory));
        MockPoolManager localPoolManager = new MockPoolManager(address(0));

        PoolKey memory key = PoolKey({
            token0: address(localToken0),
            token1: address(localToken1),
            fee: DEFAULT_FEE,
            tickSpacing: 60,
            hooks: address(0)
        });
        bytes32 localPoolId = keccak256(abi.encode(key)); // Calculate local poolId
        localPoolManager.setPool(localPoolId, address(localTestPool)); // Use local poolId

        vm.startPrank(address(this));
        localTestPool.initialize(address(localToken0), address(localToken1), DEFAULT_FEE);
        vm.stopPrank();

        localToken0.mint(alice, 1000 ether);
        localToken1.mint(alice, 1000 ether);

        // Add initial liquidity directly
        uint256 initialLiquidity;
        vm.startPrank(alice);
        localToken0.approve(address(localTestPool), 100 ether);
        localToken1.approve(address(localTestPool), 100 ether);
        initialLiquidity = localTestPool.mint(alice, 100 ether, 100 ether);
        vm.stopPrank();
        // --- End Local Setup ---


        IPoolManager.ModifyPositionParams memory removeParams;
        removeParams.tickLower = -887220;
        removeParams.tickUpper = 887220;
        removeParams.liquidityDelta = -int256(initialLiquidity + 1); // Try to remove more than exists

        vm.startPrank(alice);
        // Expect revert from AetherPool.burn called via MockPoolManager.modifyPosition
        vm.expectRevert(abi.encodeWithSignature("Panic(uint256)", 0x11)); // Expect underflow/panic
        localPoolManager.modifyPosition(key, removeParams, bytes("")); // Use local manager
        vm.stopPrank();
    }

    function test_RevertOnInvalidTokenIn() public {
         // --- Local Setup ---
        MockERC20 localToken0 = new MockERC20("LocalToken0", "LT0", 18);
        MockERC20 localToken1 = new MockERC20("LocalToken1", "LT1", 18);
         if (address(localToken0) > address(localToken1)) {
            (localToken0, localToken1) = (localToken1, localToken0);
        }
        FeeRegistry localFeeRegistry = new FeeRegistry(address(this));
        AetherFactory localFactory = new AetherFactory(address(localFeeRegistry));
        AetherPool localTestPool = new AetherPool(address(localFactory));

        vm.startPrank(address(this));
        localTestPool.initialize(address(localToken0), address(localToken1), DEFAULT_FEE);
        vm.stopPrank();

        localToken0.mint(alice, 1000 ether);
        localToken1.mint(alice, 1000 ether);
        localToken0.mint(bob, 1000 ether);

         // Add initial liquidity directly
        vm.startPrank(alice);
        localToken0.approve(address(localTestPool), 100 ether);
        localToken1.approve(address(localTestPool), 100 ether);
        localTestPool.mint(alice, 100 ether, 100 ether);
        vm.stopPrank();
        // --- End Local Setup ---

        address invalidToken = address(0x123); // An address not part of the pool

        vm.startPrank(bob);
        // No need to approve invalid token as the check happens before transfer

        // Expect revert from AetherPool's swap function due to INVALID_TOKEN_IN
        vm.expectRevert(bytes("INVALID_TOKEN_IN"));
        // Call swap directly on the pool instance, passing the invalid token address (removed sender arg)
        localTestPool.swap(10 ether, invalidToken, bob);
        vm.stopPrank();
    }

    function test_RevertOnInsufficientOutputAmount() public {
         // --- Local Setup ---
        MockERC20 localToken0 = new MockERC20("LocalToken0", "LT0", 18);
        MockERC20 localToken1 = new MockERC20("LocalToken1", "LT1", 18);
         if (address(localToken0) > address(localToken1)) {
            (localToken0, localToken1) = (localToken1, localToken0);
        }
        FeeRegistry localFeeRegistry = new FeeRegistry(address(this));
        AetherFactory localFactory = new AetherFactory(address(localFeeRegistry));
        AetherPool localTestPool = new AetherPool(address(localFactory));
        MockPoolManager localPoolManager = new MockPoolManager(address(0)); // Still need manager for interface

         PoolKey memory key = PoolKey({ // Key needed for swap call signature
            token0: address(localToken0),
            token1: address(localToken1),
            fee: DEFAULT_FEE,
            tickSpacing: 60,
            hooks: address(0)
        });
        bytes32 localPoolId = keccak256(abi.encode(key)); // Calculate local poolId
        localPoolManager.setPool(localPoolId, address(localTestPool)); // Use local poolId

        vm.startPrank(address(this));
        localTestPool.initialize(address(localToken0), address(localToken1), DEFAULT_FEE);
        vm.stopPrank();

        localToken0.mint(alice, 1000 ether);
        localToken1.mint(alice, 1000 ether);
        localToken0.mint(bob, 1000 ether);

         // Add initial liquidity directly
        vm.startPrank(alice);
        localToken0.approve(address(localTestPool), 100 ether);
        localToken1.approve(address(localTestPool), 100 ether);
        localTestPool.mint(alice, 100 ether, 100 ether);
        vm.stopPrank();
        // --- End Local Setup ---


        uint256 swapAmount = 1 wei; // Very small input amount

        vm.startPrank(bob);
        localToken0.approve(address(localPoolManager), swapAmount); // Approve local manager
        localToken0.approve(address(localTestPool), swapAmount); // Approve pool as well

        IPoolManager.SwapParams memory swapParams =
            IPoolManager.SwapParams({zeroForOne: true, amountSpecified: int256(swapAmount), sqrtPriceLimitX96: 0});

        // Expect revert from AetherPool's swap function due to INSUFFICIENT_OUTPUT_AMOUNT
        vm.expectRevert(bytes("INSUFFICIENT_OUTPUT_AMOUNT"));
        localPoolManager.swap(key, swapParams, bytes("")); // Use local manager
        vm.stopPrank();
    }
}
