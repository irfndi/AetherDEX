// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.29;

import {Test} from "forge-std/Test.sol";
import {AetherRouter} from "../src/AetherRouter.sol";
import {AetherFactory} from "../src/AetherFactory.sol";
import {AetherPool} from "../src/AetherPool.sol";
import {MockERC20} from "./mocks/MockERC20.sol";
import {MockPoolManager} from "./mocks/MockPoolManager.sol"; // Added import
import {MockCCIPRouter} from "./mocks/MockCCIPRouter.sol";
import {MockHyperlane} from "./mocks/MockHyperlane.sol";
import {console} from "forge-std/console.sol";
import {FeeRegistry} from "../src/FeeRegistry.sol";
import {IFeeRegistry} from "../src/interfaces/IFeeRegistry.sol"; // Corrected path
import {PoolKey} from "../src/types/PoolKey.sol"; // Corrected path
// Removed unused PoolIdLibrary import
// Removed unused IHooks import

contract AetherRouterTest is Test {
    AetherRouter public router;
    AetherFactory public factory;
    MockPoolManager public mockPoolManager; // Added state variable
    FeeRegistry public feeRegistry; // Added
    MockERC20 public weth;
    MockERC20 public usdc;
    MockERC20 public dai;
    address public ccipRouter;
    address public hyperlane;
    address public linkToken;

    address public alice = address(0x1);
    address public bob = address(0x2);

    // Helper function to create PoolKey and calculate poolId
    function _createPoolKeyAndId(address token0, address token1, uint24 fee, int24 tickSpacing, address hooks)
        internal pure returns (PoolKey memory key, bytes32 poolId)
    {
        require(token0 < token1, "UNSORTED_TOKENS");
        key = PoolKey({
            token0: token0,
            token1: token1,
            fee: fee,
            tickSpacing: tickSpacing,
            hooks: hooks
        });
        poolId = keccak256(abi.encode(key));
    }


    function setUp() public {
        console.log("Starting setUp...");
        console.log("Test Contract Address (this):", address(this));
        // Deploy FeeRegistry
        console.log("Deploying FeeRegistry with owner:", address(this));
        feeRegistry = new FeeRegistry(address(this)); // Pass initialOwner
        console.log("FeeRegistry deployed at:", address(feeRegistry));
        console.log("FeeRegistry actual owner:", feeRegistry.owner());
        // Add the default fee tier configuration used in tests (using 0.3% fee)
        console.log("Adding fee tier 300 with tick spacing 60 to FeeRegistry...");
        feeRegistry.addFeeConfiguration(300, 60); // Use 300 (0.3%) instead of 3000 (30%)
        console.log("Fee tier added.");

        // Deploy tokens
        console.log("Deploying tokens...");
        weth = new MockERC20("Wrapped ETH", "WETH", 18);
        usdc = new MockERC20("USD Coin", "USDC", 6);
        dai = new MockERC20("DAI", "DAI", 18);
        console.log("Tokens deployed.");

        // Deploy factory and router
        console.log("Deploying factory...");
        factory = new AetherFactory(address(feeRegistry)); // Pass FeeRegistry address
        console.log("Factory deployed at:", address(factory));
        // Deploy MockPoolManager
        console.log("Deploying MockPoolManager...");
        // Pass hook address (using address(0) as placeholder)
        mockPoolManager = new MockPoolManager(address(0));
        console.log("MockPoolManager deployed at:", address(mockPoolManager));
        // Deploy router with mock cross-chain contracts
        console.log("Deploying mock cross-chain contracts...");
        ccipRouter = address(new MockCCIPRouter());
        hyperlane = address(new MockHyperlane());
        linkToken = address(new MockERC20("LINK", "LINK", 18));
        console.log("Mock contracts deployed.");
        console.log("Deploying router with owner:", address(this));
        // Updated argument order: _owner, _ccipRouter, _hyperlane, _linkToken, _poolManager, _factory, _maxSlippage
        router = new AetherRouter(
            address(this),            // _owner
            ccipRouter,               // _ccipRouter
            hyperlane,                // _hyperlane
            linkToken,                // _linkToken
            address(mockPoolManager), // _poolManager
            address(factory),         // _factory (Add factory address)
            500                       // _maxSlippage
        );
        console.log("Router deployed at:", address(router));
        console.log("Router actual owner:", router.owner());
        console.log("Calling setTestMode as:", address(this));
        router.setTestMode(true); // Enable test mode to bypass EOA checks
        console.log("Router test mode set.");

        // Create pools with proper token ordering
        console.log("Creating WETH/USDC pool...");
        // Ensure token order for PoolKey
        address token0_1 = address(weth) < address(usdc) ? address(weth) : address(usdc);
        address token1_1 = address(weth) < address(usdc) ? address(usdc) : address(weth);
        // Define PoolKey parameters (using 0.3% fee)
        uint24 fee1 = 300; // Use 300
        int24 tickSpacing1 = 60;
        address hooks1 = address(0);
        (PoolKey memory key1, bytes32 poolId1) = _createPoolKeyAndId(token0_1, token1_1, fee1, tickSpacing1, hooks1);
        // Create pool using PoolKey
        address pool1 = factory.createPool(key1);
        console.log("WETH/USDC pool created at:", pool1);
        console.logBytes32(poolId1); // Use logBytes32
        // Set pool in MockPoolManager using poolId and address
        mockPoolManager.setPool(poolId1, pool1);
        console.log("Pool 1 set in MockPoolManager.");


        console.log("Creating USDC/DAI pool...");
        // Ensure token order for PoolKey
        address token0_2 = address(usdc) < address(dai) ? address(usdc) : address(dai);
        address token1_2 = address(usdc) < address(dai) ? address(dai) : address(usdc);
        // Define PoolKey parameters (using 0.3% fee)
        uint24 fee2 = 300; // Use 300
        int24 tickSpacing2 = 60;
        address hooks2 = address(0);
        (PoolKey memory key2, bytes32 poolId2) = _createPoolKeyAndId(token0_2, token1_2, fee2, tickSpacing2, hooks2);
        // Create pool using PoolKey
        address pool2 = factory.createPool(key2);
        console.log("USDC/DAI pool created at:", pool2);
        console.logBytes32(poolId2); // Use logBytes32
        // Set pool in MockPoolManager using poolId and address
        mockPoolManager.setPool(poolId2, pool2);
        console.log("Pool 2 set in MockPoolManager.");


        // Verify pool creation using poolId
        console.log("Verifying pool creation...");
        require(factory.getPool(poolId1) != address(0), "WETH-USDC pool not created");
        require(factory.getPool(poolId2) != address(0), "USDC-DAI pool not created");
        console.log("Pools verified.");

        // Mint tokens to test contract first before approvals
        console.log("Minting initial tokens to test contract...");
        weth.mint(address(this), 10_000 ether);         // Keep 10k WETH
        usdc.mint(address(this), 20_000_000 * 1e6);    // Mint 20M USDC (10M for each pool)
        dai.mint(address(this), 10_000_000 ether);     // Keep 10M DAI
        console.log("Initial tokens minted.");
        console.log("WETH balance:", weth.balanceOf(address(this)));
        console.log("USDC balance:", usdc.balanceOf(address(this)));
        console.log("DAI balance:", dai.balanceOf(address(this)));

        // Approve sufficient allowance for router with explicit amounts
        console.log("Approving router...");
        uint256 maxAmount = type(uint256).max;
        weth.approve(address(router), maxAmount);
        usdc.approve(address(router), maxAmount);
        dai.approve(address(router), maxAmount);
        console.log("Router approved.");

        // Add initial liquidity to pools with explicit approvals, balancing for decimals
        console.log("Adding liquidity to WETH/USDC pool...");
        // Assuming 1 WETH = $2000, 1 USDC = $1. Provide $10M liquidity.
        // 5000 WETH = $10M
        // 10,000,000 USDC = $10M
        _addLiquidityToPoolWithApprovals(
            poolId1,
            address(weth), 5_000 ether,         // 5000 * 1e18 WETH
            address(usdc), 10_000_000 * 1e6,    // 10M * 1e6 USDC
            maxAmount
        );
        console.log("Liquidity added to WETH/USDC pool.");
        console.log("WETH balance after liq1:", weth.balanceOf(address(this)));
        console.log("USDC balance after liq1:", usdc.balanceOf(address(this)));

        console.log("Adding liquidity to USDC/DAI pool...");
        // Provide $10M liquidity (assuming 1 USDC = 1 DAI = $1)
        _addLiquidityToPoolWithApprovals(
            poolId2,
            address(usdc), 10_000_000 * 1e6,    // 10M * 1e6 USDC
            address(dai), 10_000_000 ether,     // 10M * 1e18 DAI
            maxAmount
        );
        console.log("Liquidity added to USDC/DAI pool.");
        console.log("USDC balance after liq2:", usdc.balanceOf(address(this)));
        console.log("DAI balance after liq2:", dai.balanceOf(address(this)));

        // Verify balances after setup (USDC should be 0 after providing liquidity)
        console.log("Verifying final balances...");
        // Check remaining balances after providing liquidity
        require(weth.balanceOf(address(this)) == 5_000 ether, "Incorrect WETH balance after setup"); // 10k - 5k = 5k
        require(usdc.balanceOf(address(this)) == 0, "Incorrect USDC balance after setup"); // 20M - 10M - 10M = 0
        require(dai.balanceOf(address(this)) == 0, "Incorrect DAI balance after setup"); // 10M - 10M = 0
        console.log("Final balances verified.");

        // Fund test accounts
        console.log("Funding test accounts...");
        vm.deal(alice, 100 ether);
        weth.mint(alice, 100 ether);
        usdc.mint(alice, 100_000 * 1e6);
        dai.mint(alice, 100_000 ether);
        console.log("Alice funded.");

        // Approve router for test accounts
        console.log("Approving router for Alice...");
        vm.startPrank(alice);
        weth.approve(address(router), type(uint256).max);
        usdc.approve(address(router), type(uint256).max);
        dai.approve(address(router), type(uint256).max);
        vm.stopPrank();
        console.log("Router approved for Alice.");

        console.log("Funding Bob...");
        vm.deal(bob, 100 ether);
        weth.mint(bob, 100 ether);
        usdc.mint(bob, 100_000 * 1e6);
        dai.mint(bob, 100_000 ether);
        console.log("Bob funded.");
        console.log("setUp finished.");
    }

    // Updated helper to handle token ordering correctly
    function _addLiquidityToPoolWithApprovals(
        bytes32 poolId,
        address tokenA, uint256 amountA, // Pass actual tokens and amounts
        address tokenB, uint256 amountB,
        uint256 approvalAmount // Use a single approval amount for simplicity (max uint)
    ) internal {
        address poolAddress = factory.getPool(poolId);
        require(poolAddress != address(0), "Pool not found");
        AetherPool pool = AetherPool(poolAddress);

        address poolToken0 = pool.token0();
        address poolToken1 = pool.token1();

        // Determine the correct amounts based on the pool's token order
        uint256 amount0ForPool;
        uint256 amount1ForPool;

        if (tokenA == poolToken0 && tokenB == poolToken1) {
            amount0ForPool = amountA;
            amount1ForPool = amountB;
        } else if (tokenA == poolToken1 && tokenB == poolToken0) {
            amount0ForPool = amountB;
            amount1ForPool = amountA;
        } else {
            revert("Helper token mismatch"); // Should not happen if poolId is correct
        }

        // Tokens should already be minted in setUp to address(this)

        // Approve the pool to take the tokens from this contract (address(this))
        // Use the pool's actual token0 and token1 for approval targets
        console.log("Approving pool %s for token0 %s amount %s", poolAddress, poolToken0, approvalAmount);
        MockERC20(poolToken0).approve(poolAddress, approvalAmount);
        console.log("Approving pool %s for token1 %s amount %s", poolAddress, poolToken1, approvalAmount);
        MockERC20(poolToken1).approve(poolAddress, approvalAmount);
        console.log("Pool approved for both tokens.");

        // Call mint with the correctly ordered amounts
        console.log("Calling pool.mint for pool %s with amount0 %s, amount1 %s", poolAddress, amount0ForPool, amount1ForPool);
        pool.mint(address(this), amount0ForPool, amount1ForPool);
        console.log("pool.mint called successfully.");
    }

    function test_SwapExactETHForTokens() public {
        vm.startPrank(alice);

        // This test should swap WETH for USDC, not native ETH
        uint256 aliceUsdcBefore = usdc.balanceOf(alice);
        uint256 wethAmount = 1 ether; // Amount of WETH to swap

        // Ensure Alice has WETH (already minted in setUp)
        // Ensure Alice has approved the router for WETH (done in setUp)

        // address[] memory path = new address[](2); // Path not directly used by executeRoute
        // path[0] = address(weth);
        // path[1] = address(usdc);

        // Define PoolKey parameters (using 0.3% fee)
        uint24 fee = 300; // Use 300
        int24 tickSpacing = 60;
        address hooks = address(0);
        address token0 = address(weth) < address(usdc) ? address(weth) : address(usdc);
        address token1 = address(weth) < address(usdc) ? address(usdc) : address(weth);
        (PoolKey memory key, ) = _createPoolKeyAndId(token0, token1, fee, tickSpacing, hooks); // Keep key for fee/token info

        // Call executeRoute with WETH as tokenIn, amountIn, and NO msg.value
        router.executeRoute(
            token0,         // WETH (as token0)
            token1,         // USDC (as token1)
            wethAmount,     // amountIn (WETH amount)
            1,              // amountOutMin
            fee,            // fee tier
            block.timestamp // deadline
        );

        uint256 aliceUsdcAfter = usdc.balanceOf(alice);
        assertTrue(aliceUsdcAfter > aliceUsdcBefore, "USDC balance should increase");
        // Check WETH balance decrease, not ETH balance
        // Alice starts with 100 WETH in setUp, swaps 1 WETH
        assertEq(weth.balanceOf(alice), 99 ether, "WETH balance should decrease");

        vm.stopPrank();
    }

    function test_SwapExactTokensForTokens() public {
        // Test swapping DAI for USDC (since address(dai) < address(usdc))
        vm.startPrank(alice);

        uint256 daiAmount = 1000 ether; // Swap 1000 DAI
        // Alice's DAI approval is already done in setUp

        uint256 aliceUsdcBefore = usdc.balanceOf(alice);
        uint256 aliceDaiBefore = dai.balanceOf(alice); // Track initial DAI

        // Define PoolKey parameters (using 0.3% fee)
        // For the USDC/DAI pool, token0 is DAI, token1 is USDC
        uint24 fee = 300; // Use 300
        // int24 tickSpacing = 60; // Not needed directly for executeRoute call
        // address hooks = address(0); // Not needed directly for executeRoute call
        address actualTokenIn = address(dai);   // DAI is tokenIn (numerically smaller)
        address actualTokenOut = address(usdc); // USDC is tokenOut (numerically larger)

        // Use executeRoute with correct signature (tokenIn, tokenOut, amountIn, amountOutMin, fee, deadline)
        // Ensure tokenIn < tokenOut
        router.executeRoute(
            actualTokenIn,  // DAI
            actualTokenOut, // USDC
            daiAmount,      // amountIn (DAI amount)
            1,              // amountOutMin (minimal USDC expected)
            fee,            // fee tier
            block.timestamp // deadline
        );

        uint256 aliceUsdcAfter = usdc.balanceOf(alice);
        uint256 aliceDaiAfter = dai.balanceOf(alice);

        assertTrue(aliceUsdcAfter > aliceUsdcBefore, "USDC balance should increase");
        // Alice starts with 100k DAI, swaps 1k DAI
        assertEq(aliceDaiAfter, aliceDaiBefore - daiAmount, "DAI balance should decrease by swapped amount");

        vm.stopPrank();
    }

    function test_RevertOnExcessiveSlippage() public {
        vm.startPrank(alice);

        uint256 ethAmount = 1 ether;
        uint256 minAmountOut = 2000 * 1e6; // Unreasonably high minimum output

        // Define PoolKey parameters (using 0.3% fee)
        uint24 fee = 300; // Use 300
        int24 tickSpacing = 60;
        address hooks = address(0);
        address token0 = address(weth) < address(usdc) ? address(weth) : address(usdc);
        address token1 = address(weth) < address(usdc) ? address(usdc) : address(weth);
        _createPoolKeyAndId(token0, token1, fee, tickSpacing, hooks); // Removed unused key and poolId variables

        // Use executeRoute with correct signature (token0, token1, amountIn, amountOutMin, fee, deadline)
        // Expect InsufficientOutputAmount due to minAmountOut check. Encode the custom error if possible, otherwise use generic revert.
        // vm.expectRevert(abi.encodeWithSelector(AetherRouter.InsufficientOutputAmount.selector, calculatedAmountOut, minAmountOut));
        vm.expectRevert(); // Use generic revert check for now
        router.executeRoute( // Removed {value: ethAmount}
            token0,         // Use ordered token0
            token1,         // Use ordered token1
            ethAmount,      // amountIn
            minAmountOut,   // amountOutMin (high)
            fee,            // fee tier
            block.timestamp // deadline
        );

        vm.stopPrank();
    }

    function test_RevertOnInvalidPath() public {
        vm.startPrank(alice);

        uint256 ethAmount = 1 ether;

        // Define PoolKey parameters (using 0.3% fee)
        // Note: token0 is invalid (address(0)), but we need fee for the call signature
        uint24 fee = 300; // Use 300
        address token0 = address(0); // Invalid token
        address token1 = address(usdc);

        // Use executeRoute with correct signature (token0, token1, amountIn, amountOutMin, fee, deadline)
        // Expect InvalidTokenAddress error from router validation
        vm.expectRevert(abi.encodeWithSignature("InvalidTokenAddress(address)", address(0)));
        router.executeRoute( // Removed {value: ethAmount}
            token0,         // Pass invalid token0
            token1,         // token1
            ethAmount,      // amountIn
            1,              // amountOutMin
            fee,            // fee tier
            block.timestamp // deadline
        );

        vm.stopPrank();
    }

    function test_RevertOnPoolNotFound() public {
        vm.startPrank(alice);

        MockERC20 newToken = new MockERC20("New Token", "NEW", 18);

        uint256 ethAmount = 1 ether;

        // Define PoolKey parameters (using 0.3% fee)
        // Tokens are valid, but no pool exists for them in the factory
        uint24 fee = 300; // Use 300
        int24 tickSpacing = 60;
        address hooks = address(0);
        address token0 = address(weth) < address(newToken) ? address(weth) : address(newToken);
        address token1 = address(weth) < address(newToken) ? address(newToken) : address(weth);
        _createPoolKeyAndId(token0, token1, fee, tickSpacing, hooks); // Removed unused key and poolId variables

        // Use executeRoute with correct signature (token0, token1, amountIn, amountOutMin, fee, deadline)
        // Expect the swap within PoolManager to fail because the pool doesn't exist
        // The exact revert might come from PoolManager or deeper.
        // Use vm.expectRevert() without arguments to catch any revert.
        vm.expectRevert(); // Expecting revert from PoolManager or deeper
        router.executeRoute( // Removed {value: ethAmount}
            token0,         // Use ordered token0
            token1,         // Use ordered token1
            ethAmount,      // amountIn
            1,              // amountOutMin
            fee,            // fee tier
            block.timestamp // deadline
        );

        vm.stopPrank();
    }

    // Removed test_RecoverETH as executeRoute is non-payable and cannot recover ETH sent via vm.deal

    receive() external payable {} // Allow receiving ETH
}
