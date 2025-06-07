// SPDX-License-Identifier: GPL-3.0

/*
Created by irfndi (github.com/irfndi) - Apr 2025
Email: join.mantap@gmail.com
*/

pragma solidity ^0.8.29;

import {Test} from "forge-std/Test.sol";
import {IAetherPool} from "../../src/interfaces/IAetherPool.sol";
import {MockERC20} from "../mocks/MockERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract AetherPoolVyperTest is Test {
    IAetherPool public pool;
    MockERC20 public token0;
    MockERC20 public token1;
    address public owner;
    address public constant ALICE = address(0x1);
    address public constant ROUTER = address(0x2); // Simulate router
    uint24 public constant FEE = 3000; // 0.3% Fee tier

    uint256 internal constant MIN_LIQUIDITY_VYPER = 1000; // Matches Vyper's MIN_LIQUIDITY

    function setUp() public {
        owner = address(this); // For deploying the pool

        // Deploy Vyper pool with factory address as owner
        bytes memory constructorArgs = abi.encode(owner); // Factory is 'this' contract for test purposes
        address poolAddress = vm.deployCode("src/security/AetherPool.vy", constructorArgs);
        pool = IAetherPool(poolAddress);

        // Deploy mock tokens
        // Ensure token0 < token1 for consistent ordering if IAetherPool requires it
        address t0_temp = address(new MockERC20("Token0", "TKNA", 18));
        address t1_temp = address(new MockERC20("Token1", "TKNB", 18));

        if (t0_temp < t1_temp) {
            token0 = MockERC20(t0_temp);
            token1 = MockERC20(t1_temp);
        } else {
            token0 = MockERC20(t1_temp);
            token1 = MockERC20(t0_temp);
        }

        // Initialize the deployed Vyper pool
        pool.initialize(address(token0), address(token1), FEE);

        // Mint initial tokens for ALICE to provide initial liquidity
        uint256 initialLiquidityAmount0 = 100e18;
        uint256 initialLiquidityAmount1 = 100e18;
        token0.mint(ALICE, initialLiquidityAmount0 + 500e18); // Extra for other tests for ALICE
        token1.mint(ALICE, initialLiquidityAmount1 + 500e18);

        // ALICE approves pool to spend tokens for initial liquidity
        vm.startPrank(ALICE);
        token0.approve(address(pool), initialLiquidityAmount0);
        token1.approve(address(pool), initialLiquidityAmount1);

        // Add initial liquidity
        // The Vyper pool's addInitialLiquidity returns total liquidity, not user's share
        uint256 totalLiquidity = pool.addInitialLiquidity(initialLiquidityAmount0, initialLiquidityAmount1);
        uint256 aliceLp = totalLiquidity - MIN_LIQUIDITY_VYPER;
        assertEq(IERC20(address(pool)).balanceOf(ALICE), aliceLp, "ALICE initial LP balance mismatch");
        vm.stopPrank();

        // Mint tokens for ROUTER for addLiquidityNonInitial tests
        token0.mint(ROUTER, 1000e18);
        token1.mint(ROUTER, 1000e18);
    }

    function test_addLiquidityNonInitial_RevertIfNoInitialLiquidity() public {
        // Deploy a new pool for this test to ensure no initial liquidity
        bytes memory constructorArgs = abi.encode(owner);
        address newPoolAddress = vm.deployCode("src/security/AetherPool.vy", constructorArgs);
        IAetherPool newPool = IAetherPool(newPoolAddress);
        newPool.initialize(address(token0), address(token1), FEE);

        uint256 amount0Desired = 10e18;
        uint256 amount1Desired = 10e18;

        // ROUTER approves tokens to the new pool
        vm.startPrank(ROUTER);
        token0.approve(address(newPool), amount0Desired);
        token1.approve(address(newPool), amount1Desired);
        // ROUTER transfers tokens to the new pool
        token0.transfer(address(newPool), amount0Desired);
        token1.transfer(address(newPool), amount1Desired);
        vm.stopPrank();

        vm.expectRevert(bytes("NON_INITIAL_LIQUIDITY_ONLY"));
        vm.prank(ROUTER);
        newPool.addLiquidityNonInitial(ALICE, amount0Desired, amount1Desired, "");
    }

    function test_addLiquidityNonInitial_PerfectRatio_EmitMintEvent() public {
        uint256 currentReserve0 = token0.balanceOf(address(pool));
        uint256 currentReserve1 = token1.balanceOf(address(pool));
        uint256 currentTotalSupply = IERC20(address(pool)).totalSupply();

        // Provide amounts in perfect ratio to current reserves
        // Example: Add 50% of current reserves
        uint256 amount0Desired = currentReserve0 / 2;
        uint256 amount1Desired = currentReserve1 / 2;

        // Expected liquidity: liquidity = amount0Desired * totalSupply / reserve0
        uint256 expectedLiquidityMinted = (amount0Desired * currentTotalSupply) / currentReserve0;

        // ROUTER's initial balances
        uint256 routerToken0Before = token0.balanceOf(ROUTER);
        uint256 routerToken1Before = token1.balanceOf(ROUTER);
        // ALICE's initial balances (recipient of LP tokens and potential refunds)
        uint256 aliceToken0Before = token0.balanceOf(ALICE);
        uint256 aliceToken1Before = token1.balanceOf(ALICE);
        uint256 aliceLpBefore = IERC20(address(pool)).balanceOf(ALICE);
        // Pool's initial token balances (should match reserves)
        uint256 poolToken0Before = token0.balanceOf(address(pool));
        uint256 poolToken1Before = token1.balanceOf(address(pool));


        // ROUTER approves tokens to the pool and transfers them
        vm.startPrank(ROUTER);
        token0.approve(address(pool), amount0Desired);
        token1.approve(address(pool), amount1Desired);
        token0.transfer(address(pool), amount0Desired);
        token1.transfer(address(pool), amount1Desired);
        vm.stopPrank();

        // Expect Mint event
        // event Mint(address indexed sender, address indexed owner, uint256 amount0, uint256 amount1, uint256 liquidity);
        vm.expectEmit(true, true, true, true, address(pool)); // Check topics and data
        emit IAetherPool.Mint(ROUTER, ALICE, amount0Desired, amount1Desired, expectedLiquidityMinted);

        // ROUTER calls addLiquidityNonInitial, sending LP tokens to ALICE
        vm.startPrank(ROUTER);
        (uint256 amount0Actual, uint256 amount1Actual, uint256 liquidityMinted) =
            pool.addLiquidityNonInitial(ALICE, amount0Desired, amount1Desired, "");
        vm.stopPrank();

        // --- Assertions ---
        // 1. Returned values
        assertEq(amount0Actual, amount0Desired, "amount0Actual should match amount0Desired for perfect ratio");
        assertEq(amount1Actual, amount1Desired, "amount1Actual should match amount1Desired for perfect ratio");
        assertEq(liquidityMinted, expectedLiquidityMinted, "liquidityMinted mismatch");

        // 2. No refund should occur
        assertEq(token0.balanceOf(ALICE), aliceToken0Before, "ALICE token0 balance changed (no refund expected)");
        assertEq(token1.balanceOf(ALICE), aliceToken1Before, "ALICE token1 balance changed (no refund expected)");

        // 3. ROUTER's token balances
        assertEq(token0.balanceOf(ROUTER), routerToken0Before - amount0Desired, "ROUTER token0 balance mismatch");
        assertEq(token1.balanceOf(ROUTER), routerToken1Before - amount1Desired, "ROUTER token1 balance mismatch");

        // 4. Pool's token balances (reserves)
        uint256 expectedPoolToken0After = poolToken0Before + amount0Actual;
        uint256 expectedPoolToken1After = poolToken1Before + amount1Actual;
        assertEq(token0.balanceOf(address(pool)), expectedPoolToken0After, "Pool token0 balance mismatch");
        assertEq(token1.balanceOf(address(pool)), expectedPoolToken1After, "Pool token1 balance mismatch");
        assertEq(IAetherPool(address(pool)).reserve0(), expectedPoolToken0After, "Pool reserve0 mismatch");
        assertEq(IAetherPool(address(pool)).reserve1(), expectedPoolToken1After, "Pool reserve1 mismatch");

        // 5. ALICE's LP token balance
        assertEq(IERC20(address(pool)).balanceOf(ALICE), aliceLpBefore + liquidityMinted, "ALICE LP balance mismatch");

        // 6. Pool's total supply
        assertEq(IERC20(address(pool)).totalSupply(), currentTotalSupply + liquidityMinted, "Pool total supply mismatch");
    }

    function test_addLiquidityNonInitial_Amount0Limits_RefundToken1() public {
        uint256 currentReserve0 = IAetherPool(address(pool)).reserve0();
        uint256 currentReserve1 = IAetherPool(address(pool)).reserve1();
        uint256 currentTotalSupply = IERC20(address(pool)).totalSupply();

        // amount0Desired is limiting, amount1Desired is in excess
        uint256 amount0Desired = currentReserve0 / 5; // e.g., 20% of reserve0
        uint256 amount1Desired = currentReserve1;   // e.g., 100% of reserve1 (clearly excess)

        // Calculate expected actual amounts and liquidity
        uint256 expectedAmount0Actual = amount0Desired;
        uint256 expectedAmount1Actual = (amount0Desired * currentReserve1) / currentReserve0;
        uint256 expectedLiquidityMinted = (expectedAmount0Actual * currentTotalSupply) / currentReserve0;
        uint256 expectedRefund1 = amount1Desired - expectedAmount1Actual;

        // Balances before operation
        uint256 routerToken0Before = token0.balanceOf(ROUTER);
        uint256 routerToken1Before = token1.balanceOf(ROUTER);
        uint256 aliceToken0Before = token0.balanceOf(ALICE);
        uint256 aliceToken1Before = token1.balanceOf(ALICE);
        uint256 aliceLpBefore = IERC20(address(pool)).balanceOf(ALICE);
        uint256 poolToken0Before = token0.balanceOf(address(pool));
        uint256 poolToken1Before = token1.balanceOf(address(pool));

        // ROUTER approves and transfers tokens to the pool
        vm.startPrank(ROUTER);
        token0.approve(address(pool), amount0Desired);
        token1.approve(address(pool), amount1Desired);
        token0.transfer(address(pool), amount0Desired);
        token1.transfer(address(pool), amount1Desired);
        vm.stopPrank();

        // Expect Mint event
        vm.expectEmit(true, true, true, true, address(pool));
        emit IAetherPool.Mint(ROUTER, ALICE, expectedAmount0Actual, expectedAmount1Actual, expectedLiquidityMinted);

        // ROUTER calls addLiquidityNonInitial
        vm.startPrank(ROUTER);
        (uint256 amount0Actual, uint256 amount1Actual, uint256 liquidityMinted) =
            pool.addLiquidityNonInitial(ALICE, amount0Desired, amount1Desired, "");
        vm.stopPrank();

        // --- Assertions ---
        // 1. Returned values
        assertEq(amount0Actual, expectedAmount0Actual, "amount0Actual mismatch");
        assertEq(amount1Actual, expectedAmount1Actual, "amount1Actual mismatch");
        assertEq(liquidityMinted, expectedLiquidityMinted, "liquidityMinted mismatch");

        // 2. ROUTER's token balances (decreased by DESIRED amounts as they were transferred)
        assertEq(token0.balanceOf(ROUTER), routerToken0Before - amount0Desired, "ROUTER token0 balance mismatch");
        assertEq(token1.balanceOf(ROUTER), routerToken1Before - amount1Desired, "ROUTER token1 balance mismatch");

        // 3. ALICE's token balances (recipient of refund)
        assertEq(token0.balanceOf(ALICE), aliceToken0Before, "ALICE token0 balance should not change");
        assertEq(token1.balanceOf(ALICE), aliceToken1Before + expectedRefund1, "ALICE token1 balance (refund) mismatch");

        // 4. ALICE's LP token balance
        assertEq(IERC20(address(pool)).balanceOf(ALICE), aliceLpBefore + liquidityMinted, "ALICE LP balance mismatch");

        // 5. Pool's token balances (increased by ACTUAL amounts, refund sent from these)
        // The pool received amount0Desired, amount1Desired. It used Actuals and refunded the rest.
        // So final balance is initial + Desired - Refund = initial + Actual
        assertEq(token0.balanceOf(address(pool)), poolToken0Before + expectedAmount0Actual, "Pool token0 balance mismatch");
        assertEq(token1.balanceOf(address(pool)), poolToken1Before + expectedAmount1Actual, "Pool token1 balance mismatch");

        // 6. Pool's reserves
        assertEq(IAetherPool(address(pool)).reserve0(), currentReserve0 + expectedAmount0Actual, "Pool reserve0 mismatch");
        assertEq(IAetherPool(address(pool)).reserve1(), currentReserve1 + expectedAmount1Actual, "Pool reserve1 mismatch");

        // 7. Pool's total supply
        assertEq(IERC20(address(pool)).totalSupply(), currentTotalSupply + liquidityMinted, "Pool total supply mismatch");
    }

    function test_addLiquidityNonInitial_Amount1Limits_RefundToken0() public {
        uint256 currentReserve0 = IAetherPool(address(pool)).reserve0();
        uint256 currentReserve1 = IAetherPool(address(pool)).reserve1();
        uint256 currentTotalSupply = IERC20(address(pool)).totalSupply();

        // amount1Desired is limiting, amount0Desired is in excess
        uint256 amount1Desired = currentReserve1 / 4; // e.g., 25% of reserve1
        uint256 amount0Desired = currentReserve0;   // e.g., 100% of reserve0 (clearly excess)

        // Calculate expected actual amounts and liquidity
        uint256 expectedAmount1Actual = amount1Desired;
        uint256 expectedAmount0Actual = (amount1Desired * currentReserve0) / currentReserve1;
        uint256 expectedLiquidityMinted = (expectedAmount1Actual * currentTotalSupply) / currentReserve1; // Can also use 0 side
        uint256 expectedRefund0 = amount0Desired - expectedAmount0Actual;

        // Balances before operation
        uint256 routerToken0Before = token0.balanceOf(ROUTER);
        uint256 routerToken1Before = token1.balanceOf(ROUTER);
        uint256 aliceToken0Before = token0.balanceOf(ALICE);
        uint256 aliceToken1Before = token1.balanceOf(ALICE);
        uint256 aliceLpBefore = IERC20(address(pool)).balanceOf(ALICE);
        uint256 poolToken0Before = token0.balanceOf(address(pool));
        uint256 poolToken1Before = token1.balanceOf(address(pool));

        // ROUTER approves and transfers tokens to the pool
        vm.startPrank(ROUTER);
        token0.approve(address(pool), amount0Desired);
        token1.approve(address(pool), amount1Desired);
        token0.transfer(address(pool), amount0Desired);
        token1.transfer(address(pool), amount1Desired);
        vm.stopPrank();

        // Expect Mint event
        vm.expectEmit(true, true, true, true, address(pool));
        emit IAetherPool.Mint(ROUTER, ALICE, expectedAmount0Actual, expectedAmount1Actual, expectedLiquidityMinted);

        // ROUTER calls addLiquidityNonInitial
        vm.startPrank(ROUTER);
        (uint256 amount0Actual, uint256 amount1Actual, uint256 liquidityMinted) =
            pool.addLiquidityNonInitial(ALICE, amount0Desired, amount1Desired, "");
        vm.stopPrank();

        // --- Assertions ---
        // 1. Returned values
        assertEq(amount0Actual, expectedAmount0Actual, "amount0Actual mismatch");
        assertEq(amount1Actual, expectedAmount1Actual, "amount1Actual mismatch");
        assertEq(liquidityMinted, expectedLiquidityMinted, "liquidityMinted mismatch");

        // 2. ROUTER's token balances (decreased by DESIRED amounts)
        assertEq(token0.balanceOf(ROUTER), routerToken0Before - amount0Desired, "ROUTER token0 balance mismatch");
        assertEq(token1.balanceOf(ROUTER), routerToken1Before - amount1Desired, "ROUTER token1 balance mismatch");

        // 3. ALICE's token balances (recipient of refund)
        assertEq(token0.balanceOf(ALICE), aliceToken0Before + expectedRefund0, "ALICE token0 balance (refund) mismatch");
        assertEq(token1.balanceOf(ALICE), aliceToken1Before, "ALICE token1 balance should not change");

        // 4. ALICE's LP token balance
        assertEq(IERC20(address(pool)).balanceOf(ALICE), aliceLpBefore + liquidityMinted, "ALICE LP balance mismatch");

        // 5. Pool's token balances (increased by ACTUAL amounts)
        assertEq(token0.balanceOf(address(pool)), poolToken0Before + expectedAmount0Actual, "Pool token0 balance mismatch");
        assertEq(token1.balanceOf(address(pool)), poolToken1Before + expectedAmount1Actual, "Pool token1 balance mismatch");

        // 6. Pool's reserves
        assertEq(IAetherPool(address(pool)).reserve0(), currentReserve0 + expectedAmount0Actual, "Pool reserve0 mismatch");
        assertEq(IAetherPool(address(pool)).reserve1(), currentReserve1 + expectedAmount1Actual, "Pool reserve1 mismatch");

        // 7. Pool's total supply
        assertEq(IERC20(address(pool)).totalSupply(), currentTotalSupply + liquidityMinted, "Pool total supply mismatch");
    }

    function test_addLiquidityNonInitial_RevertIfActualAmountCalculatesToZero() public {
        // Setup a pool with skewed reserves to force one actual amount to be zero
        bytes memory constructorArgs = abi.encode(owner);
        address newPoolAddress = vm.deployCode("src/security/AetherPool.vy", constructorArgs);
        IAetherPool newPool = IAetherPool(newPoolAddress);

        // Use new tokens to avoid interference if ordering matters for the test itself
        MockERC20 newTk0 = new MockERC20("NewToken0", "NTK0", 18);
        MockERC20 newTk1 = new MockERC20("NewToken1", "NTK1", 18);
        address newTk0Addr = address(newTk0);
        address newTk1Addr = address(newTk1);
        if (address(newTk0) > address(newTk1)) { // Ensure ordering
            newTk0Addr = address(newTk1);
            newTk1Addr = address(newTk0);
            MockERC20 temp = newTk0;
            newTk0 = newTk1;
            newTk1 = temp;
        }
        newPool.initialize(newTk0Addr, newTk1Addr, FEE);

        uint256 initial0 = 200e18;
        uint256 initial1 = 100e18; // reserve1 < reserve0

        newTk0.mint(ALICE, initial0);
        newTk1.mint(ALICE, initial1);

        vm.startPrank(ALICE);
        newTk0.approve(address(newPool), initial0);
        newTk1.approve(address(newPool), initial1);
        newPool.addInitialLiquidity(initial0, initial1);
        vm.stopPrank();
        // Pool state: reserve0 = 200e18, reserve1 = 100e18. totalSupply = sqrt(200*100)e18 = 141.42e18

        uint256 amount0Desired = 1; // Tiny amount for token0
        uint256 amount1Desired = 1; // Tiny amount for token1, actual calculation will make amount1Actual = 0
                                    // val0 = 1 * 100e18, val1 = 1 * 200e18. val0 < val1.
                                    // amount0Actual = 1
                                    // amount1Actual = (1 * 100e18) / 200e18 = 0.

        // ROUTER needs these new tokens
        newTk0.mint(ROUTER, amount0Desired);
        newTk1.mint(ROUTER, amount1Desired);

        vm.startPrank(ROUTER);
        newTk0.approve(address(newPool), amount0Desired);
        newTk1.approve(address(newPool), amount1Desired);
        newTk0.transfer(address(newPool), amount0Desired);
        newTk1.transfer(address(newPool), amount1Desired);
        vm.stopPrank();

        vm.expectRevert(bytes("ZERO_ACTUAL_AMOUNTS"));
        vm.prank(ROUTER);
        newPool.addLiquidityNonInitial(ALICE, amount0Desired, amount1Desired, "");
    }

/*
    function test_Mint_And_Burn() public {
        // Assume pool is ready after deployment in setUp
        // Initialization via interface is removed.

        uint256 amount0 = 100 ether;
        uint256 amount1 = 100 ether;
        token0.mint(address(this), amount0);
        token1.mint(address(this), amount1);
        token0.approve(address(pool), amount0);
        token1.approve(address(pool), amount1);

        // This call will fail as the mint signature changed
        // uint256 liquidity = pool.mint(address(this), amount0, amount1);
        // assertGt(liquidity, 0, "liquidity should be greater than zero");

        // uint256 r0_after = token0.balanceOf(address(pool));
        // uint256 r1_after = token1.balanceOf(address(pool));
        // assertEq(r0_after, amount0, "reserve0 mismatch after mint");
        // assertEq(r1_after, amount1, "reserve1 mismatch after mint");

        // // Burn liquidity
        // (uint256 burn0, uint256 burn1) = pool.burn(address(this), liquidity);
        // assertGt(burn0, 0, "burned token0 should be greater than zero");
        // assertGt(burn1, 0, "burned token1 should be greater than zero");

        // // Final reserves should return to zero
        // uint256 final0 = token0.balanceOf(address(pool));
        // uint256 final1 = token1.balanceOf(address(pool));
        // assertLe(final0, 1, "final reserve0 should be near zero"); 
        // assertLe(final1, 1, "final reserve1 should be near zero"); 
    }
*/
}
