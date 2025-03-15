// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.29;

import {Test} from "forge-std/Test.sol";
import {AetherPool} from "../src/AetherPool.sol";
import {MockERC20} from "./mocks/MockERC20.sol";

/**
 * @title AetherPoolTest
 * @dev Unit tests for the AetherPool contract, focusing on liquidity operations
 */
contract AetherPoolTest is Test {
    AetherPool pool;
    MockERC20 token0;
    MockERC20 token1;

    address factory = address(0x1);
    address alice = address(0x2);
    address bob = address(0x3);

    function setUp() public {
        // Deploy mock tokens
        token0 = new MockERC20("Token0", "TKN0", 18);
        token1 = new MockERC20("Token1", "TKN1", 18);

        // Deploy pool
        pool = new AetherPool(factory);
        pool.initialize(address(token0), address(token1));

        // Mint tokens to test accounts
        token0.mint(alice, 1000 ether);
        token1.mint(alice, 1000 ether);
        token0.mint(bob, 1000 ether);
        token1.mint(bob, 1000 ether);

        // Approve pool to spend tokens
        vm.startPrank(alice);
        token0.approve(address(pool), type(uint256).max);
        token1.approve(address(pool), type(uint256).max);
        vm.stopPrank();

        vm.startPrank(bob);
        token0.approve(address(pool), type(uint256).max);
        token1.approve(address(pool), type(uint256).max);
        vm.stopPrank();
    }

    function test_Initialize() public view {
        assertEq(pool.token0(), address(token0), "Token0 not set correctly");
        assertEq(pool.token1(), address(token1), "Token1 not set correctly");
        assertEq(pool.factory(), factory, "Factory not set correctly");
        assertTrue(pool.initialized(), "Pool not initialized");
    }

    function test_AddLiquidity() public {
        uint256 amount0 = 100 ether;
        uint256 amount1 = 100 ether;

        vm.startPrank(alice);
        uint256 liquidity = pool.mint(alice, amount0, amount1);
        vm.stopPrank();

        assertEq(pool.totalSupply(), liquidity, "Total supply not updated correctly");
        assertEq(pool.reserve0(), amount0, "Reserve0 not updated correctly");
        assertEq(pool.reserve1(), amount1, "Reserve1 not updated correctly");
        assertEq(token0.balanceOf(address(pool)), amount0, "Pool token0 balance incorrect");
        assertEq(token1.balanceOf(address(pool)), amount1, "Pool token1 balance incorrect");
    }

    function test_RemoveLiquidity() public {
        // First add liquidity
        uint256 amount0 = 100 ether;
        uint256 amount1 = 100 ether;

        vm.startPrank(alice);
        uint256 liquidity = pool.mint(alice, amount0, amount1);

        // Now test removing half of the liquidity
        uint256 burnAmount = liquidity / 2;

        // Capture event to verify it's emitted correctly
        vm.expectEmit(true, false, false, true);
        emit AetherPool.LiquidityRemoved(alice, amount0 / 2, amount1 / 2, burnAmount);

        (uint256 returned0, uint256 returned1) = pool.burn(alice, burnAmount);
        vm.stopPrank();

        // Verify returned amounts
        assertEq(returned0, amount0 / 2, "Incorrect amount of token0 returned");
        assertEq(returned1, amount1 / 2, "Incorrect amount of token1 returned");

        // Verify pool state
        assertEq(pool.totalSupply(), liquidity - burnAmount, "Total supply not updated correctly");
        assertEq(pool.reserve0(), amount0 - returned0, "Reserve0 not updated correctly");
        assertEq(pool.reserve1(), amount1 - returned1, "Reserve1 not updated correctly");

        // Verify token balances
        assertEq(token0.balanceOf(address(pool)), amount0 - returned0, "Pool token0 balance incorrect");
        assertEq(token1.balanceOf(address(pool)), amount1 - returned1, "Pool token1 balance incorrect");
        assertEq(token0.balanceOf(alice), 1000 ether - amount0 + returned0, "Alice token0 balance incorrect");
        assertEq(token1.balanceOf(alice), 1000 ether - amount1 + returned1, "Alice token1 balance incorrect");
    }

    function test_Swap() public {
        // First add liquidity
        uint256 amount0 = 100 ether;
        uint256 amount1 = 100 ether;

        vm.startPrank(alice);
        pool.mint(alice, amount0, amount1);
        vm.stopPrank();

        // Now test swap
        uint256 swapAmount = 10 ether;

        vm.startPrank(bob);
        // Calculate expected output based on constant product formula with fee
        uint256 amountInWithFee = swapAmount * (10000 - pool.FEE()) / 10000;
        uint256 expectedOut = amountInWithFee * pool.reserve1() / (pool.reserve0() + amountInWithFee);

        // Capture event to verify it's emitted correctly
        vm.expectEmit(true, false, false, true);
        emit AetherPool.Swap(bob, address(token0), address(token1), swapAmount, expectedOut);

        pool.swap(swapAmount, address(token0), bob, bob);
        vm.stopPrank();

        // Verify balances
        assertEq(token0.balanceOf(bob), 1000 ether - swapAmount, "Bob token0 balance incorrect");
        assertApproxEqRel(token1.balanceOf(bob), 1000 ether + expectedOut, 1e15, "Bob token1 balance incorrect");

        // Verify reserves
        assertApproxEqRel(pool.reserve0(), amount0 + swapAmount, 1e15, "Reserve0 not updated correctly");
        assertApproxEqRel(pool.reserve1(), amount1 - expectedOut, 1e15, "Reserve1 not updated correctly");
    }

    function test_RevertOnReinitialize() public {
        vm.expectRevert("INITIALIZED");
        pool.initialize(address(token0), address(token1));
    }

    function test_RevertOnInsufficientLiquidityMinted() public {
        vm.startPrank(alice);
        vm.expectRevert("INSUFFICIENT_LIQUIDITY_MINTED");
        pool.mint(alice, 0, 100);
        vm.stopPrank();
    }

    function test_RevertOnInsufficientLiquidityBurned() public {
        // First add liquidity
        vm.startPrank(alice);
        pool.mint(alice, 100 ether, 100 ether);

        // Try to burn a very small amount that would result in zero token amounts
        // This should trigger the INSUFFICIENT_LIQUIDITY_BURNED error
        vm.expectRevert("INSUFFICIENT_LIQUIDITY_BURNED");
        pool.burn(alice, 1); // Very small amount that would result in near-zero token amounts
        vm.stopPrank();
    }

    function test_RevertOnInvalidTokenIn() public {
        // First add liquidity
        vm.startPrank(alice);
        pool.mint(alice, 100 ether, 100 ether);
        vm.stopPrank();

        // Try to swap with invalid token
        vm.startPrank(bob);
        vm.expectRevert("INVALID_TOKEN_IN");
        pool.swap(10 ether, address(0x9), bob, bob);
        vm.stopPrank();
    }

    function test_RevertOnInsufficientOutputAmount() public {
        // First add liquidity with very small amount of token1
        vm.startPrank(alice);
        pool.mint(alice, 100 ether, 0.000001 ether);
        vm.stopPrank();

        // Try to swap a very small amount which would result in numerator < denominator
        // This should trigger the INSUFFICIENT_OUTPUT_AMOUNT error
        vm.startPrank(bob);
        vm.expectRevert("INSUFFICIENT_OUTPUT_AMOUNT");
        pool.swap(0.0000000001 ether, address(token0), bob, bob); // Extremely small amount
        vm.stopPrank();
    }
}
