// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.29;

import "forge-std/console2.sol";

import "forge-std/Test.sol";
import "../src/AetherPool.sol";
import "../src/AetherFactory.sol";
import "../src/libraries/TransferHelper.sol"; // Import TransferHelper for safeTransfer

interface IERC20 { // Define IERC20 interface here - KEPT ONLY ONCE, NOW AT TOP LEVEL
    event Approval(address indexed owner, address indexed spender, uint256 value);
    event Transfer(address indexed from, address indexed to, uint256 value);
}

// Simple MockERC20 contract for testing
contract MockToken is
    IERC20 // MockToken now inherits from IERC20
{
    string public name;
    string public symbol;
    uint8 public decimals;
    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance; // Allowance mapping

    constructor(string memory _name, string memory _symbol, uint8 _decimals) {
        name = _name;
        symbol = _symbol;
        decimals = _decimals;
    }

    function mint(address to, uint256 amount) public {
        balanceOf[to] += amount;
        totalSupply += amount;
    }

    function approve(address spender, uint256 amount) public returns (bool) {
        // Implement approve function, override removed - OVERRIDE REMOVED
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) public returns (bool) {
        // Implement transferFrom function, override removed - OVERRIDE REMOVED
        uint256 allowed = allowance[from][msg.sender]; // Saves gas for limited approvals.

        if (allowed != ~uint256(0)) allowance[from][msg.sender] = allowed - amount;

        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        emit Transfer(from, to, amount);
        return true;
    }

    function transfer(address to, uint256 amount) public returns (bool) {
        // IMPLEMENT TRANSFER FUNCTION
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        emit Transfer(msg.sender, to, amount);
        return true;
    }
}

contract AetherTest is
    Test // AetherTest contract definition
{
    AetherPool public pool;
    AetherFactory public factory;
    MockToken public tokenA; // Use MockToken instead of MockERC20
    MockToken public tokenB;

    function setUp() public {
        tokenA = new MockToken("TokenA", "TKNA", 18); // Deploy MockToken tokens
        if (address(tokenA) == address(0)) revert("TokenA deployment failed"); // Check if tokenA deployment failed

        tokenB = new MockToken("TokenB", "TKNB", 18);
        if (address(tokenB) == address(0)) revert("TokenB deployment failed"); // Check if tokenB deployment failed

        factory = new AetherFactory(); // Deploy factory
        address poolAddress = factory.createPool(address(tokenA), address(tokenB)); // Create pool using factory
        pool = AetherPool(poolAddress); // Get pool from factory
        console2.log("Pool address:", address(pool));
        console2.log("TokenA address:", address(tokenA));
        console2.log("TokenB address:", address(tokenB));

        // Initialize pool with tokens (factory is msg.sender for initialize) - No need to initialize again, already initialized by factory
        // vm.startPrank(address(factory));  // COMMENTED OUT PRANK
        // pool.initialize(address(tokenA), address(tokenB)); // COMMENTED OUT INITIALIZE CALL
        // vm.stopPrank(); // COMMENTED OUT STOP PRANK

        // Add initial liquidity to the pool
        vm.startPrank(address(this)); // Use test contract as liquidity provider
        tokenA.mint(address(this), 1000 ether); // Mint tokens using MockToken.mint
        tokenB.mint(address(this), 1000 ether);
        tokenA.approve(address(pool), 1000 ether); // Approve tokens for pool
        tokenB.approve(address(pool), 1000 ether);
        console2.log("Before mint liquidity");
        pool.mint(address(this), 1000 ether, 1000 ether); // Provide initial liquidity: 1000 TokenA and 1000 TokenB
        console2.log("After mint liquidity");
        vm.stopPrank();
    }

    function test_createPool() public view {
        assertEq(address(pool), factory.getPool(address(tokenA), address(tokenB)), "Pool address mismatch");
    }

    function test_initializePool() public {
        // Deploy new tokens and create a new pool for testing initialization
        MockToken newTokenA = new MockToken("NewTokenA", "NTKNA", 18);
        MockToken newTokenB = new MockToken("NewTokenB", "NTKNB", 18);

        // Create pool through factory
        address newPoolAddress = factory.createPool(address(newTokenA), address(newTokenB));
        AetherPool newPool = AetherPool(newPoolAddress);

        // Verify pool is initialized correctly
        (address token0, address token1) = address(newTokenA) < address(newTokenB)
            ? (address(newTokenA), address(newTokenB))
            : (address(newTokenB), address(newTokenA));

        assertEq(newPool.token0(), token0, "Token0 address mismatch");
        assertEq(newPool.token1(), token1, "Token1 address mismatch");
        assertTrue(newPool.initialized(), "Pool should be initialized after factory creation");

        // Verify that re-initialization reverts
        vm.startPrank(address(factory));
        vm.expectRevert("INITIALIZED");
        newPool.initialize(address(newTokenA), address(newTokenB));
        vm.stopPrank();
    }

    function test_swapTokens() public {
        uint256 amountIn = 10 ether;
        // Calculate expected amount using x*y=k formula
        uint256 amountInWithFee = amountIn * 997 / 1000;
        (uint256 reserve0, uint256 reserve1) = pool.getReserves();
        uint256 expectedAmountOut = (amountInWithFee * reserve1) / (reserve0 + amountInWithFee);

        // Record initial state
        uint256 initialReserve0 = pool.reserve0();
        uint256 initialReserve1 = pool.reserve1();

        // Mint new tokens for swap
        vm.startPrank(address(this));
        tokenA.mint(address(this), amountIn);
        uint256 balanceBeforeSwap = tokenA.balanceOf(address(this));
        tokenA.approve(address(pool), amountIn);

        console2.log("Pool reserve0 before swap:", pool.reserve0());
        console2.log("Pool reserve1 before swap:", pool.reserve1());

        // Execute swap
        pool.swap(amountIn, address(tokenA), address(this), address(this));
        vm.stopPrank();

        // Check final state
        (uint256 finalReserve0, uint256 finalReserve1) = pool.getReserves();
        uint256 balanceAfterSwap = tokenA.balanceOf(address(this));
        uint256 tokenBReceived = tokenB.balanceOf(address(this));

        console2.log("initialReserve0:", initialReserve0);
        console2.log("amountIn:", amountIn);
        console2.log("finalReserve0:", finalReserve0);
        console2.log("initialReserve1:", initialReserve1);
        console2.log("tokenBReceived:", tokenBReceived);
        console2.log("finalReserve1:", finalReserve1);

        // Verify reserves updated correctly
        if (pool.token0() == address(tokenA)) {
            assertEq(finalReserve0, initialReserve0 + amountIn, "Reserve0 mismatch");
            assertEq(finalReserve1, initialReserve1 - tokenBReceived, "Reserve1 mismatch");
        } else {
            assertEq(finalReserve0, initialReserve0 - tokenBReceived, "Reserve0 mismatch");
            assertEq(finalReserve1, initialReserve1 + amountIn, "Reserve1 mismatch");
        }

        // Verify token balances
        assertEq(balanceAfterSwap, balanceBeforeSwap - amountIn, "TokenA balance mismatch");
        assertApproxEqAbs(tokenBReceived, expectedAmountOut, 1, "Output amount mismatch");
    }

    function test_reverseSwapTokens() public {
        uint256 amountIn = 10 ether;

        // Calculate expected amount using x*y=k formula
        uint256 amountInWithFee = amountIn * 997 / 1000;
        (uint256 reserve0, uint256 reserve1) = pool.getReserves();
        uint256 expectedAmountOut = (amountInWithFee * reserve0) / (reserve1 + amountInWithFee);

        // Record initial state
        uint256 initialReserve0 = reserve0;
        uint256 initialReserve1 = reserve1;

        // Mint new tokens for swap
        vm.startPrank(address(this));
        tokenB.mint(address(this), amountIn);
        uint256 balanceBeforeSwap = tokenB.balanceOf(address(this));
        tokenB.approve(address(pool), amountIn);

        // Execute swap
        pool.swap(amountIn, address(tokenB), address(this), address(this));
        vm.stopPrank();

        // Check final state
        (uint256 finalReserve0, uint256 finalReserve1) = pool.getReserves();
        uint256 balanceAfterSwap = tokenB.balanceOf(address(this));
        uint256 tokenAReceived = tokenA.balanceOf(address(this));

        // Verify reserves updated correctly
        if (pool.token0() == address(tokenB)) {
            assertEq(finalReserve0, initialReserve0 + amountIn, "Reserve0 mismatch");
            assertEq(finalReserve1, initialReserve1 - tokenAReceived, "Reserve1 mismatch");
        } else {
            assertEq(finalReserve0, initialReserve0 - tokenAReceived, "Reserve0 mismatch");
            assertEq(finalReserve1, initialReserve1 + amountIn, "Reserve1 mismatch");
        }

        // Verify token balances
        assertEq(balanceAfterSwap, balanceBeforeSwap - amountIn, "TokenB balance mismatch");
        assertApproxEqAbs(tokenAReceived, expectedAmountOut, 1, "Reverse swap output mismatch");
    }
}
