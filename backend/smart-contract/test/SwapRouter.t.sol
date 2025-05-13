// SPDX-License-Identifier: GPL-3.0

/*
Created by irfndi (github.com/irfndi) - Apr 2025
Email: join.mantap@gmail.com
*/

pragma solidity ^0.8.29;

import {console} from "forge-std/console.sol";

import {Test} from "forge-std/Test.sol";
import {AetherFactory} from "src/primary/AetherFactory.sol";
import {FeeRegistry} from "src/primary/FeeRegistry.sol";
import {AetherRouter} from "src/primary/AetherRouter.sol";
import {IAetherPool} from "src/interfaces/IAetherPool.sol";
import {PoolKey} from "src/types/PoolKey.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

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

    // Implement other IAetherPool functions if they become necessary for tests, possibly with reverts or default values.
    // --- End IAetherPool Implementation ---
}

contract SwapRouterTest is
    Test // AetherTest contract definition
{
    IAetherPool public pool; // Use Interface
    IAetherPool public wethUsdcPool; // Pool for WETH/USDC
    AetherFactory public factory;
    FeeRegistry public feeRegistry; // Added FeeRegistry instance
    AetherRouter public router; // Add Router instance

    MockToken public tokenA;
    MockToken public tokenB;
    MockToken public weth;
    MockToken public usdc;
    MockToken public dai;

    PoolKey public poolKeyAB; // Pool key for tokenA/tokenB
    bytes32 public poolIdAB;
    PoolKey public poolKeyWethUsdc; // Pool key for WETH/USDC
    bytes32 public poolIdWethUsdc;

    address public poolAddressAB; // Address for tokenA/tokenB pool
    address public wethUsdcPoolAddress; // Address for WETH/USDC pool

    // Helper to compute poolId from PoolKey
    function _computePoolId(PoolKey memory key) internal pure returns (bytes32) {
        return keccak256(abi.encode(key));
    }

    // Helper function to create PoolKey and calculate poolId
    function _createPoolKeyAndId(address token0, address token1, uint24 fee, int24 tickSpacing, address hooks)
        internal
        pure
        returns (PoolKey memory key, bytes32 poolId)
    {
        require(token0 < token1, "UNSORTED_TOKENS");
        key = PoolKey({token0: token0, token1: token1, fee: fee, tickSpacing: tickSpacing, hooks: hooks});
        poolId = _computePoolId(key); // Use the other helper
    }

    function setUp() public {
        vm.deal(address(this), 10 ether); // Ensure test contract has ETH

        tokenA = new MockToken("TokenA", "TKNA", 18); // Deploy MockToken tokens
        tokenB = new MockToken("TokenB", "TKNB", 18);
        weth = new MockToken("Wrapped Ether", "WETH", 18);
        usdc = new MockToken("USD Coin", "USDC", 6);
        dai = new MockToken("Dai Stablecoin", "DAI", 18);

        // Deploy Factory, FeeRegistry, and Router
        feeRegistry = new FeeRegistry(); 
        factory = new AetherFactory(address(this), address(this)); // Provide _initialOwner and _feeRecipient
        router = new AetherRouter(); // Deploy Router (no constructor args)

        // Define PoolKey parameters (assuming 3000 fee, 60 tickSpacing, no hooks)
        uint24 fee = 3000;
        int24 tickSpacing = 60;
        address hooks = address(0);

        // --- Setup for TokenA/TokenB Pool ---
        address _token0AB;
        address _token1AB;
        if (address(tokenA) < address(tokenB)) {
            _token0AB = address(tokenA);
            _token1AB = address(tokenB);
        } else {
            _token0AB = address(tokenB);
            _token1AB = address(tokenA);
        }
        (poolKeyAB, poolIdAB) = _createPoolKeyAndId(_token0AB, _token1AB, fee, tickSpacing, hooks);
        (poolAddressAB, ) = factory.createPool{value: factory.creationFee()}(
            _token0AB,
            _token1AB,
            "Test Vault AB",
            "TVAB"
        );
        pool = IAetherPool(poolAddressAB); // Store the pool instance

        // Mint initial tokens for liquidity provisioning
        uint256 amountADesired = 100 ether;
        uint256 amountBDesired = 100 ether;
        tokenA.mint(address(this), amountADesired);
        tokenA.mint(address(this), 10 ether);  // Restore extra mint for A (Total: 110e18)
        tokenB.mint(address(this), amountBDesired);
        tokenB.mint(address(this), 10 ether); // Restore extra mint for B (Total: 110e18)
        weth.mint(address(this), 1000 ether);
        usdc.mint(address(this), 1000 ether);

        // Approve Router to spend initial liquidity tokens
        tokenA.approve(address(router), type(uint256).max);
        tokenB.approve(address(router), type(uint256).max);

        // Add initial liquidity via Router
        uint256 amountAMin = 0;
        uint256 amountBMin = 0;
        uint256 deadline = block.timestamp + 60;
        vm.startPrank(address(this));
        router.addLiquidity(
            address(pool), amountADesired, amountBDesired, amountAMin, amountBMin, address(this), deadline
        );
        vm.stopPrank();

        // --- Setup for WETH/USDC Pool ---
        address _token0WU;
        address _token1WU;
        if (address(weth) < address(usdc)) {
            _token0WU = address(weth);
            _token1WU = address(usdc);
        } else {
            _token0WU = address(usdc);
            _token1WU = address(weth);
        }
        // Assuming default fee, tickSpacing, hooks for WETH/USDC pool
        // You might need to define these or use the same as A/B pool if appropriate
        (wethUsdcPoolAddress, /* vaultAddress ignored */) = factory.createPool{value: factory.creationFee()}(
            _token0WU, _token1WU, "Vault WETH/USDC", "VWU"
        );
        require(wethUsdcPoolAddress != address(0), "WETH/USDC pool creation failed"); // Check if pool address is valid

        // Mint initial WETH and USDC for liquidity
        uint256 amountWethDesired = 50 ether; // e.g., 50 WETH
        uint256 amountUsdcDesired = 50000 * 1e6; // e.g., 50,000 USDC (6 decimals)
        weth.mint(address(this), amountWethDesired);
        usdc.mint(address(this), amountUsdcDesired);

        // Approve Router for WETH/USDC liquidity
        weth.approve(address(router), type(uint256).max);
        usdc.approve(address(router), type(uint256).max);

        // Add WETH/USDC liquidity via Router
        uint256 amountWethMin = 0;
        uint256 amountUsdcMin = 0;
        vm.startPrank(address(this));
        // Ensure router.addLiquidity exists and takes these params
        // Assuming it takes pool address, amounts desired, amounts min, recipient, deadline
        router.addLiquidity(
            wethUsdcPoolAddress, amountWethDesired, amountUsdcDesired, amountWethMin, amountUsdcMin, address(this), deadline
        );
        vm.stopPrank();
        // --- End of restored block ---
    }

    function testCreatePool() public view {
        // Get the pool and vault addresses from the factory
        (address retrievedPoolAddress, ) = factory.getPool(poolKeyAB.token0, poolKeyAB.token1);
        // Assert that the retrieved pool address matches the one stored in the test setup
        assertEq(poolAddressAB, retrievedPoolAddress, "Pool address mismatch"); // Use stored address
    }

    // Test swapping exact Token A for Token B (Single Hop)
    function testSwapExactInputTokenAToB() public {
        uint256 amountIn = 1 ether; // Amount of TokenA to swap

        // Construct path for router swap: TokenA -> TokenB via poolAddress
        address[] memory path = new address[](3);
        path[0] = address(tokenA);
        path[1] = address(tokenB); // Output token
        path[2] = poolAddressAB;     // Pool address

        // Define swap parameters
        uint256 amountOutMin = 0; // No slippage for test
        uint256 deadline = block.timestamp + 60;

        // Approve and Execute the swap via the router under a single prank
        vm.startPrank(address(this)); // Start prank
        tokenA.approve(address(router), amountIn); // Approve router
        uint256[] memory amounts = router.swapExactTokensForTokens(amountIn, amountOutMin, path, address(this), deadline); // Execute swap
        vm.stopPrank(); // Stop prank

        // Check final balances
        uint256 finalBalanceA = tokenA.balanceOf(address(this));
        uint256 finalBalanceB = tokenB.balanceOf(address(this));
        // Initial A = 110, Spent 1 => Expected A = 109
        // Initial B = 110, Received amounts[1] => Expected B = 110 + amounts[1]
        assertEq(finalBalanceA, 110 ether - amountIn, "User TokenA balance incorrect");
        assertEq(finalBalanceB, 110 ether + amounts[1], "User TokenB balance incorrect"); // Use amounts[1]
    }

    // Test swapping exact Token B for Token A (Single Hop)
    function testSwapExactInputTokenBToA() public {
        uint256 amountIn = 1 ether; // Amount of TokenB to swap

        // Construct path for router swap: TokenB -> TokenA via poolAddress
        address[] memory path = new address[](3);
        path[0] = address(tokenB);
        path[1] = address(tokenA); // Output token
        path[2] = poolAddressAB;     // Pool address

        // Define swap parameters
        uint256 amountOutMin = 0; // No slippage for test
        uint256 deadline = block.timestamp + 60;

        // Approve and Execute the swap via the router under a single prank
        vm.startPrank(address(this)); // Start prank
        tokenB.approve(address(router), amountIn); // Approve router
        uint256[] memory amounts = router.swapExactTokensForTokens(amountIn, amountOutMin, path, address(this), deadline); // Execute swap
        vm.stopPrank(); // Stop prank

        // Check final balances
        uint256 finalBalanceA = tokenA.balanceOf(address(this));
        uint256 finalBalanceB = tokenB.balanceOf(address(this));
        // Initial B = 110, Spent 1 => Expected B = 109
        // Initial A = 110, Received amounts[1] => Expected A = 110 + amounts[1]
        assertEq(finalBalanceA, 110 ether + amounts[1], "User TokenA balance incorrect"); // Use amounts[1]
        assertEq(finalBalanceB, 110 ether - amountIn, "User TokenB balance incorrect");
    }

    function testSwapExactInputSingleHop() public {
        // ... rest of the function remains the same ...
    }

    // Test swapping WETH for USDC using the specific WETH/USDC pool
    function testSwapExactInputWethUsdc() public {
        address user = vm.addr(1);
        vm.label(user, "user");

        // Define swap parameters
        uint256 amountIn = 1 ether; // Input 1 WETH
        uint256 amountOutMinimum = 0; // Accept any output for this test
        address recipient = user;
        uint256 deadline = block.timestamp + 60;

        // Define the single-hop path: WETH -> USDC via wethUsdcPoolAddress
        address[] memory path = new address[](3);
        path[0] = address(weth);
        path[1] = address(usdc);             // Output token
        path[2] = wethUsdcPoolAddress; // Pool address

        // Ensure the user has enough WETH and has approved the router
        weth.mint(user, 10 ether); // Give the user 10 WETH
        vm.startPrank(user);
        weth.approve(address(router), amountIn);
        vm.stopPrank();

        // Execute the swap via the router
        vm.startPrank(user);
        uint256[] memory amounts = router.swapExactTokensForTokens(amountIn, amountOutMinimum, path, recipient, deadline);
        vm.stopPrank();

        // Assertions: Check user balances
        assertEq(weth.balanceOf(user), 10 ether - amountIn, "User WETH balance incorrect");
        assertEq(usdc.balanceOf(user), amounts[1], "User USDC balance incorrect"); // Use amounts[1]
        assertTrue(amounts[1] > amountOutMinimum, "Did not receive minimum USDC");
    }

    // Allow the test contract to receive ETH (needed for feeRecipient transfer)
    receive() external payable {}
}
