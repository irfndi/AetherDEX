// SPDX-License-Identifier: GPL-3.0

/*
Created by irfndi (github.com/irfndi) - Apr 2025
Email: join.mantap@gmail.com
*/

pragma solidity ^0.8.29;

import "forge-std/console2.sol";

import "forge-std/Test.sol";
import "../src/primary/AetherFactory.sol";
import "../src/primary/FeeRegistry.sol"; // Added FeeRegistry import
import {AetherRouter} from "../src/primary/AetherRouter.sol";
import {IAetherPool} from "../src/interfaces/IAetherPool.sol";
import {PoolKey} from "../lib/v4-core/src/types/PoolKey.sol"; // Specifically import PoolKey struct
import {Currency} from "v4-core/types/Currency.sol";
import {IHooks} from "v4-core/interfaces/IHooks.sol";
import {IPoolManager} from "../src/interfaces/IPoolManager.sol";
import "../src/libraries/TransferHelper.sol"; // Import TransferHelper for safeTransfer
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol"; // Import IERC20

// Simple MockToken contract for testing
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

// Define MockPool for testing IAetherPool interactions
contract MockPool is IAetherPool {
    uint24 public storedFee = 3000;
    address public token0;
    address public token1;

    // --- IAetherPool Implementation ---
    function initialize(address _token0, address _token1, uint24 _fee) external override {
        token0 = _token0;
        token1 = _token1;
        storedFee = _fee;
    }

    function fee() external view override returns (uint24) {
        return storedFee;
    }

    function tokens() external view override returns (address, address) {
        return (token0, token1);
    }

    // IAetherPool's mint (by LP amount)
    function mint(address /* recipient */, uint128 amount) 
        external 
        pure
        override 
        returns (uint256 amount0, uint256 amount1) 
    {
        // Mock: If LP amount is > 0, return some dummy token amounts
        // In a real pool, this would calculate required token amounts based on 'amount' of LP tokens
        if (amount > 0) {
            amount0 = uint256(amount) * 100; // Dummy calculation
            amount1 = uint256(amount) * 150; // Dummy calculation
        } else {
            amount0 = 0;
            amount1 = 0;
        }
        // Actual token transfers from depositor to pool would be managed by a PoolManager or similar
        // emit Mint(msg.sender, recipient, amount0, amount1, amount); // Event signature mismatch for this mint version
        return (amount0, amount1);
    }

    // This is the mint function AetherRouter.addLiquidity currently expects (even if via placeholder logic)
    // It does NOT have 'override' as its signature differs from IAetherPool's standard mint.
    function mint(address /* to */, uint256 amount0Desired, uint256 amount1Desired)
        external
        pure
        // No 'override' here as it's not matching the IAetherPool.mint(address, uint128)
        returns (uint256 amount0, uint256 amount1, uint256 liquidity)
    {
        amount0 = amount0Desired;
        amount1 = amount1Desired; // Corrected typo from amountBDesired
        liquidity = (amount0Desired + amount1Desired) / 2; 
        if (liquidity == 0 && (amount0Desired > 0 || amount1Desired > 0)) {
            liquidity = 1; 
        }
        return (amount0, amount1, liquidity);
    }

    function swap(uint256 amountIn, address tokenIn, address to)
        external
        override
        returns (uint256 amountOut)
    {
        require(tokenIn == token0 || tokenIn == token1, "MockPool: INVALID_INPUT_TOKEN");
        amountOut = amountIn / 2; // Simple mock logic for amount out

        if (amountOut > 0) {
            address tokenToTransferOut;
            if (tokenIn == token0) {
                tokenToTransferOut = token1;
            } else {
                tokenToTransferOut = token0;
            }
            IERC20(tokenToTransferOut).transfer(to, amountOut);
        }
        return amountOut;
    }

    function burn(address /* to */, uint256 liquidityToBurn) 
        external 
        pure
        override 
        returns (uint256 amount0Out, uint256 amount1Out)
    {
        // Mock: If liquidityToBurn > 0, return some dummy token amounts
        if (liquidityToBurn > 0) {
            amount0Out = liquidityToBurn * 50; // Dummy calculation
            amount1Out = liquidityToBurn * 75; // Dummy calculation
        } else {
            amount0Out = 0;
            amount1Out = 0;
        }
        // Actual token transfers from pool to 'to' address would be managed by a PoolManager or similar
        // emit Burn(msg.sender, to, amount0Out, amount1Out, liquidityToBurn);
        return (amount0Out, amount1Out);
    }

    function addInitialLiquidity(uint256 amount0Desired, uint256 amount1Desired) 
        external 
        pure
        override 
        returns (uint256 liquidityOut)
    {
        // Mock: Return some liquidity based on desired amounts
        liquidityOut = (amount0Desired + amount1Desired) / 3; // Arbitrary calculation
        if (liquidityOut == 0 && (amount0Desired > 0 || amount1Desired > 0)) {
            liquidityOut = 1; // Ensure some liquidity if inputs are positive
        }
        // Actual token transfers from depositor to pool would be managed by a PoolManager or similar
        // This would also likely set initial reserves and price
        return liquidityOut;
    }

    function addLiquidityNonInitial(
        address /* recipient */,
        uint256 amount0Desired,
        uint256 amount1Desired,
        bytes calldata /* data */
    ) external pure override returns (uint256 amount0Actual, uint256 amount1Actual, uint256 liquidityMinted) {
        // Mock: Use desired amounts as actual amounts
        amount0Actual = amount0Desired;
        amount1Actual = amount1Desired;
        liquidityMinted = (amount0Desired + amount1Desired) / 2;
        if (liquidityMinted == 0 && (amount0Desired > 0 || amount1Desired > 0)) {
            liquidityMinted = 1;
        }
        return (amount0Actual, amount1Actual, liquidityMinted);
    }

    // Implement other IAetherPool functions if they become necessary for tests, possibly with reverts or default values.
    // --- End IAetherPool Implementation ---
}

contract SwapRouterTest is
    Test // AetherTest contract definition
{
    IAetherPool public pool; // Use Interface
    AetherFactory public factory;
    FeeRegistry public feeRegistry; // Added FeeRegistry instance
    AetherRouter public router; // Add Router instance
    MockToken public tokenA; // Use MockToken instead of MockERC20
    MockToken public tokenB;
    PoolKey public poolKeyAB; // Store the key used in setUp
    bytes32 public poolIdAB; // Store the poolId used in setUp

    // Helper function to create PoolKey and calculate poolId
    function _createPoolKeyAndId(address token0, address token1, uint24 fee, int24 tickSpacing, address hooks)
        internal
        pure
        returns (PoolKey memory key, bytes32 poolId)
    {
        require(token0 < token1, "UNSORTED_TOKENS");
        key = PoolKey({currency0: Currency.wrap(token0), currency1: Currency.wrap(token1), fee: fee, tickSpacing: tickSpacing, hooks: IHooks(hooks)});
        poolId = keccak256(abi.encode(key));
    }

    function setUp() public {
        tokenA = new MockToken("TokenA", "TKNA", 18); // Deploy MockToken tokens
        if (address(tokenA) == address(0)) revert("TokenA deployment failed"); // Check if tokenA deployment failed

        tokenB = new MockToken("TokenB", "TKNB", 18);
        if (address(tokenB) == address(0)) revert("TokenB deployment failed"); // Check if tokenB deployment failed

        // Ensure canonical order
        address _token0 = address(tokenA) < address(tokenB) ? address(tokenA) : address(tokenB);
        address _token1 = address(tokenA) < address(tokenB) ? address(tokenB) : address(tokenA);

        // --- Deploy Core Contracts ---
        feeRegistry = new FeeRegistry(address(this), address(this), 500); // Deploy FeeRegistry with treasury and 5% protocol fee
        factory = new AetherFactory(address(this), address(feeRegistry), 3000); // Pass owner, registry, and initial pool fee of 0.3%
        router = new AetherRouter(); // Deploy Router with factory and roleManager

        // Define PoolKey parameters (assuming 3000 fee, 60 tickSpacing, no hooks)
        uint24 fee = 3000;
        int24 tickSpacing = 60;
        address hooks = address(0);

        // Instantiate PoolKey for reference (though poolId might not be needed directly now)
        (poolKeyAB, poolIdAB) = _createPoolKeyAndId(_token0, _token1, fee, tickSpacing, hooks);

        // --- Deploy & Register Pool (Placeholder - Vyper Deployment) ---
        console2.log("Deploying Vyper Pool (Placeholder)...Now MockPool");
        // Replace with actual vm.deployCode for AetherPool.vy
        // address deployedPoolAddress = address(0x1); // Placeholder address
        MockPool mockPool = new MockPool();
        address deployedPoolAddress = address(mockPool);
        require(deployedPoolAddress != address(0), "Pool deployment failed");

        // Fund the MockPool with tokens for swapping
        uint256 poolSupply = 100000 ether; // Large enough supply for tests
        tokenA.mint(deployedPoolAddress, poolSupply);
        tokenB.mint(deployedPoolAddress, poolSupply);

        // Initialize the mock pool as it would be by AetherFactory.createPool
        // Although AetherFactory.registerPool doesn't initialize, the router might expect it.
        // And the mock pool's fee() function might need it.
        IAetherPool(deployedPoolAddress).initialize(_token0, _token1, fee);

        // Register the deployed pool with the factory
        console2.log("Registering pool with factory...");
        factory.registerPool(deployedPoolAddress, _token0, _token1); // Register pool
        pool = IAetherPool(deployedPoolAddress); // Assign to interface variable
        console2.log("Pool registered. Address:", deployedPoolAddress);
        console2.log("TokenA address:", address(tokenA));
        console2.log("TokenB address:", address(tokenB));

        // --- Add Initial Liquidity via Router ---
        console2.log("Adding initial liquidity via Router...");
        uint256 amountADesired = 1000 ether;
        uint256 amountBDesired = 1000 ether;
        uint256 amountAMin = 0; // No slippage for initial seed
        uint256 amountBMin = 0;
        uint256 deadline = block.timestamp + 60; // Set deadline

        // Approve the ROUTER to spend tokens
        tokenA.approve(address(router), type(uint256).max);
        tokenB.approve(address(router), type(uint256).max);

        // Call router's addLiquidity
        vm.startPrank(address(this)); // Simulate 'this' as the caller
        ( /* uint256 amountAActual */ , /* uint256 amountBActual */, uint256 liquidity) = router.addLiquidity(
            address(pool), amountADesired, amountBDesired, amountAMin, amountBMin, address(this), deadline
        );
        vm.stopPrank();

        console2.log("Initial liquidity added via router. Liquidity tokens:", liquidity);
        // assertTrue(liquidity > 0, "Initial liquidity minting failed");
    }

    function test_createPool() public view {
        // Use poolId calculated in setUp
        assertEq(address(pool), factory.getPoolAddress(address(uint160(Currency.unwrap(poolKeyAB.currency0))), address(uint160(Currency.unwrap(poolKeyAB.currency1))), poolKeyAB.fee), "Pool address mismatch"); // Correct: Use getPoolAddress with fee parameter
    }

    function test_swapTokens() public {
        uint256 amountIn = 10 ether;

        // Calculate expected amount using x*y=k formula and the actual pool fee
        // uint256 currentFee = pool.getFee(); // Get actual fee from pool
        // uint256 amountInWithFee = (amountIn * (10000 - currentFee)) / 10000; // Unused variable

        // Mint tokens to 'this' for swapping
        tokenA.mint(address(this), amountIn);
        uint256 balanceBeforeSwap = tokenA.balanceOf(address(this));

        // Approve ROUTER to spend tokenA
        tokenA.approve(address(router), amountIn);

        // Construct path for router swap
        address[] memory path = new address[](3);
        path[0] = address(tokenA); // Input token
        path[1] = address(tokenB); // Output token (determines swap direction implicitly in simple pool)
        path[2] = address(pool); // Pool address

        uint256 amountOutMin = 0; // No slippage for test
        uint256 deadline = block.timestamp + 60;

        // Execute swap via Router
        vm.startPrank(address(this));
        uint256[] memory amounts =
            router.swapExactTokensForTokens(amountIn, amountOutMin, path, address(this), deadline);
        vm.stopPrank();

        // Check final state
        uint256 balanceAfterSwap = tokenA.balanceOf(address(this));
        uint256 tokenBReceived = tokenB.balanceOf(address(this));

        // Verify token balances
        assertEq(balanceAfterSwap, balanceBeforeSwap - amountIn, "TokenA balance mismatch");
        assertEq(amounts[1], tokenBReceived, "Router return mismatch vs balance");
        assertTrue(tokenBReceived > 0, "Should receive some TokenB"); // Basic check
    }

    function test_reverseSwapTokens() public {
        uint256 amountIn = 10 ether;

        // Calculate expected amount using x*y=k formula and the actual pool fee
        // uint256 currentFee = pool.getFee(); // Get actual fee from pool
        // uint256 amountInWithFee = (amountIn * (10000 - currentFee)) / 10000; // Unused variable

        // Mint tokens to 'this' for swapping
        tokenB.mint(address(this), amountIn);
        uint256 balanceBeforeSwap = tokenB.balanceOf(address(this));

        // Approve ROUTER to spend tokenB
        tokenB.approve(address(router), amountIn);

        // Construct path for router swap (reverse)
        address[] memory path = new address[](3);
        path[0] = address(tokenB); // Input token
        path[1] = address(tokenA); // Output token
        path[2] = address(pool); // Pool address

        uint256 amountOutMin = 0; // No slippage for test
        uint256 deadline = block.timestamp + 60;

        // Execute swap via Router
        vm.startPrank(address(this));
        uint256[] memory amounts =
            router.swapExactTokensForTokens(amountIn, amountOutMin, path, address(this), deadline);
        vm.stopPrank();

        // Check final state
        uint256 balanceAfterSwap = tokenB.balanceOf(address(this));
        uint256 tokenAReceived = tokenA.balanceOf(address(this));

        // Verify token balances
        assertEq(balanceAfterSwap, balanceBeforeSwap - amountIn, "TokenB balance mismatch");
        assertEq(amounts[1], tokenAReceived, "Router return mismatch vs balance");
        assertTrue(tokenAReceived > 0, "Should receive some TokenA"); // Basic check
    }
}
