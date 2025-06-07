// SPDX-License-Identifier: GPL-3.0

/*
Created by irfndi (github.com/irfndi) - Apr 2025
Email: join.mantap@gmail.com
*/

pragma solidity ^0.8.29;

import {Test} from "forge-std/Test.sol";
import {MockERC20} from "@mocks/MockERC20.sol"; // Using remapping
import {AetherFactory} from "@primary/AetherFactory.sol"; // Using remapping
// import {AetherRouter} from "@primary/AetherRouter.sol"; // Old Router is deleted
import {LiquidityRouter, SimpleSwapRouter} from "@primary/RouterImports.sol";
// Note: SwapRouter from RouterImports.sol is an alias for SimpleSwapRouter. Using SimpleSwapRouter directly.
import {IAetherPool} from "@interfaces/IAetherPool.sol"; // Using remapping
import {FeeRegistry} from "@primary/FeeRegistry.sol"; // Using remapping
import {MockPoolManager} from "@mocks/MockPoolManager.sol"; // Using remapping
import {MockCCIPRouter} from "@mocks/MockCCIPRouter.sol"; // Using remapping
import {MockHyperlane} from "@mocks/MockHyperlane.sol"; // Using remapping
import {console} from "forge-std/console.sol";
import {PoolKey} from "@types/PoolKey.sol"; // Using remapping
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol"; // For addLiquidity tests
import {Errors} from "@libraries/Errors.sol"; // Using remapping

contract AetherRouterTest is Test {
    // AetherRouter public router; // Old router, now an empty shell
    LiquidityRouter public liquidityRouter_AetherRouterTest; // For addLiquidity calls if any were here
    SimpleSwapRouter public swapRouter_AetherRouterTest;       // For swap calls if any were here
    AetherFactory public factory;
    FeeRegistry public feeRegistry;
    IAetherPool public pool;
    MockPoolManager public mockPoolManager;
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
        internal
        pure
        returns (PoolKey memory key, bytes32 poolId)
    {
        require(token0 < token1, "UNSORTED_TOKENS");
        key = PoolKey({token0: token0, token1: token1, fee: fee, tickSpacing: tickSpacing, hooks: hooks});
        poolId = keccak256(abi.encode(key));
    }

    function setUp() public {
        console.log("Starting setUp...");
        console.log("Test Contract Address (this):", address(this));
        // Deploy FeeRegistry
        // console.log("Deploying FeeRegistry with owner:", address(this));
        // feeRegistry = new FeeRegistry(address(this)); // Pass initialOwner - FeeRegistry is abstract
        // console.log("FeeRegistry deployed at:", address(feeRegistry));
        // console.log("FeeRegistry actual owner:", feeRegistry.owner());
        // Add the default fee tier configuration used in tests (using 0.3% fee)
        // console.log("Adding fee tier 300 with tick spacing 60 to FeeRegistry...");
        // feeRegistry.addFeeConfiguration(300, 60); // Use 300 (0.3%) instead of 3000 (30%)
        // console.log("Fee tier added.");

        // Deploy tokens
        console.log("Deploying tokens...");
        weth = new MockERC20("Wrapped ETH", "WETH", 18);
        usdc = new MockERC20("USD Coin", "USDC", 6);
        dai = new MockERC20("DAI", "DAI", 18);
        console.log("Tokens deployed.");

        // Deploy factory and router
        console.log("Deploying factory...");
        factory = new AetherFactory(address(this), address(feeRegistry), 3000); // Pass owner, feeRegistry, and initial pool fee of 0.3%
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
        // Deploy router with required constructor args
        // router = new AetherRouter(); // Old router is empty
        liquidityRouter_AetherRouterTest = new LiquidityRouter();
        swapRouter_AetherRouterTest = new SimpleSwapRouter();
        console.log("Routers deployed for AetherRouterTest.");

        // Create pools with proper token ordering
        console.log("Deploying and registering WETH/USDC pool (placeholder)...");
        address wethUsdcPool = address(0x1); // Placeholder: Deploy Vyper pool via vm.deployCode
        factory.registerPool(wethUsdcPool, address(weth), address(usdc));
        console.log("WETH/USDC Pool registered:", wethUsdcPool);

        console.log("Deploying and registering WETH/DAI pool (placeholder)...");
        address wethDaiPool = address(0x2); // Placeholder: Deploy Vyper pool via vm.deployCode
        factory.registerPool(wethDaiPool, address(weth), address(dai));
        console.log("WETH/DAI Pool registered:", wethDaiPool);

        // Mint tokens to test contract first before approvals
        console.log("Minting initial tokens to test contract...");
        weth.mint(address(this), 10_000 ether); // Keep 10k WETH
        usdc.mint(address(this), 20_000_000 * 1e6); // Mint 20M USDC (10M for each pool)
        dai.mint(address(this), 10_000_000 ether); // Keep 10M DAI
        console.log("Initial tokens minted.");
        console.log("WETH balance:", weth.balanceOf(address(this)));
        console.log("USDC balance:", usdc.balanceOf(address(this)));
        console.log("DAI balance:", dai.balanceOf(address(this)));

        // Approve sufficient allowance for router with explicit amounts
        console.log("Approving router...");
        uint256 maxAmount = type(uint256).max;
        // Approvals for LiquidityRouter if used by _addLiquidityToPoolWithApprovals if it were calling a router
        weth.approve(address(liquidityRouter_AetherRouterTest), maxAmount);
        usdc.approve(address(liquidityRouter_AetherRouterTest), maxAmount);
        dai.approve(address(liquidityRouter_AetherRouterTest), maxAmount);
        // Approvals for SwapRouter if used by any test in AetherRouterTest
        weth.approve(address(swapRouter_AetherRouterTest), maxAmount);
        usdc.approve(address(swapRouter_AetherRouterTest), maxAmount);
        dai.approve(address(swapRouter_AetherRouterTest), maxAmount);
        console.log("Routers approved for AetherRouterTest.");

        // Add initial liquidity to pools with explicit approvals, balancing for decimals
        console.log("Adding liquidity to WETH/USDC pool...");
        // Assuming 1 WETH = $2000, 1 USDC = $1. Provide $10M liquidity.
        // 5000 WETH = $10M
        // 10,000,000 USDC = $10M
        _addLiquidityToPoolWithApprovals(
            wethUsdcPool,
            address(weth),
            5_000 ether, // 5000 * 1e18 WETH
            address(usdc),
            10_000_000 * 1e6, // 10M * 1e6 USDC
            maxAmount
        );
        console.log("Liquidity added to WETH/USDC pool.");
        console.log("WETH balance after liq1:", weth.balanceOf(address(this)));
        console.log("USDC balance after liq1:", usdc.balanceOf(address(this)));

        console.log("Adding liquidity to USDC/DAI pool...");
        // Provide $10M liquidity (assuming 1 USDC = 1 DAI = $1)
        _addLiquidityToPoolWithApprovals(
            wethDaiPool, // Use wethDaiPool address for the second pool setup
            address(usdc),
            10_000_000 * 1e6, // 10M * 1e6 USDC
            address(dai),
            10_000_000 ether, // 10M * 1e18 DAI
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
        weth.approve(address(liquidityRouter_AetherRouterTest), type(uint256).max);
        usdc.approve(address(liquidityRouter_AetherRouterTest), type(uint256).max);
        dai.approve(address(liquidityRouter_AetherRouterTest), type(uint256).max);
        weth.approve(address(swapRouter_AetherRouterTest), type(uint256).max);
        usdc.approve(address(swapRouter_AetherRouterTest), type(uint256).max);
        dai.approve(address(swapRouter_AetherRouterTest), type(uint256).max);
        vm.stopPrank();
        console.log("Routers approved for Alice.");

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
        address poolAddress,
        address tokenA,
        uint256 amountA, // Pass actual tokens and amounts
        address tokenB,
        uint256 amountB,
        uint256 approvalAmount // Use a single approval amount for simplicity (max uint)
    ) internal {
        require(poolAddress != address(0), "Pool not found");
        (address poolToken0, address poolToken1) = IAetherPool(poolAddress).tokens();

        uint256 amount0ForPool;
        uint256 amount1ForPool;

        if (tokenA == poolToken0 && tokenB == poolToken1) {
            amount0ForPool = amountA;
            amount1ForPool = amountB;
        } else if (tokenA == poolToken1 && tokenB == poolToken0) {
            amount0ForPool = amountB;
            amount1ForPool = amountA;
        } else {
            revert("Helper token mismatch");
        }

        console.log("Approving pool %s for token0 %s amount %s", poolAddress, poolToken0, approvalAmount);
        MockERC20(poolToken0).approve(poolAddress, approvalAmount);
        console.log("Approving pool %s for token1 %s amount %s", poolAddress, poolToken1, approvalAmount);
        MockERC20(poolToken1).approve(poolAddress, approvalAmount);
        console.log("Pool approved for both tokens.");

        console.log(
            "Calling pool.mint for pool %s with amount0 %s, amount1 %s", poolAddress, amount0ForPool, amount1ForPool
        );
        // TODO: Add liquidity via PoolManager or update test logic
        console.log("pool.mint called successfully.");
    }
}

// --- Tests for addLiquidity ---
abstract contract ControllableMockIAetherPool is IAetherPool {
    address public _token0;
    address public _token1;

    uint256 public expectedAmount0Actual;
    uint256 public expectedAmount1Actual;
    uint256 public expectedLiquidityMinted;
    bool public shouldRevertAddLiquidityNonInitial;
    string public revertMessageAddLiquidityNonInitial_str;

    function tokens() external view virtual override returns (address token0, address token1) {
        return (_token0, _token1);
    }

    function addLiquidityNonInitial(
        address recipient,
        uint256 amount0Desired,
        uint256 amount1Desired,
        bytes calldata data
    ) external virtual override returns (uint256 amount0Actual, uint256 amount1Actual, uint256 liquidityMinted) {
        if (shouldRevertAddLiquidityNonInitial) {
            revert(revertMessageAddLiquidityNonInitial_str);
        }
        return (expectedAmount0Actual, expectedAmount1Actual, expectedLiquidityMinted);
    }

    function setTokens(address t0, address t1) external {
        if (t0 < t1) {
            _token0 = t0;
            _token1 = t1;
        } else {
            _token0 = t1;
            _token1 = t0;
        }
    }

    function setExpectedAddLiquidityNonInitialValues(uint256 amt0Actual, uint256 amt1Actual, uint256 liqMinted) external {
        expectedAmount0Actual = amt0Actual;
        expectedAmount1Actual = amt1Actual;
        expectedLiquidityMinted = liqMinted;
    }

    function setRevertAddLiquidityNonInitial(bool revertFlag, string memory message) external {
        shouldRevertAddLiquidityNonInitial = revertFlag;
        revertMessageAddLiquidityNonInitial_str = message;
    }

    function fee() external view virtual override returns (uint24) { return 3000; }
    function reserve0() external view virtual override returns (uint256) { return 1000e18; }
    function reserve1() external view virtual override returns (uint256) { return 1000e18; }
    function mint(address, uint128) external virtual override returns (uint256, uint256) { revert("Mock: Unimplemented"); }
    function burn(address, uint256) external virtual override returns (uint256, uint256) { revert("Mock: Unimplemented"); }
    function swap(uint256, address, address) external virtual override returns (uint256) { revert("Mock: Unimplemented"); }
    function initialize(address, address, uint24) external virtual override { /* no-op */ }
    function addInitialLiquidity(uint256, uint256) external virtual override returns (uint256) { revert("Mock: Unimplemented"); }
}

contract AetherRouterAddLiquidityTest is Test {
    LiquidityRouter liquidityRouter;
    ControllableMockIAetherPool mockPool;
    MockERC20 tokenA;
    MockERC20 tokenB;

    address alice = vm.addr(1);
    address bob_recipient = vm.addr(2);

    uint256 constant ONE_ETHER = 1 ether;

    function setUp() public {
        liquidityRouter = new LiquidityRouter();

        tokenA = new MockERC20("TokenA", "TKNA", 18);
        tokenB = new MockERC20("TokenB", "TKNB", 18);

        vm.etch(address(123), type(ConcreteMockPool).creationCode);
        mockPool = ControllableMockIAetherPool(address(123));

        mockPool.setTokens(address(tokenA), address(tokenB));

        tokenA.mint(alice, 1000 * ONE_ETHER);
        tokenB.mint(alice, 1000 * ONE_ETHER);

        vm.startPrank(alice);
        tokenA.approve(address(liquidityRouter), type(uint256).max);
        tokenB.approve(address(liquidityRouter), type(uint256).max);
        vm.stopPrank();
    }

    function test_AddLiquidity_HappyPath() public {
        uint256 amountADesired = 100 * ONE_ETHER;
        uint256 amountBDesired = 100 * ONE_ETHER;
        uint256 amountAMin = 99 * ONE_ETHER;
        uint256 amountBMin = 99 * ONE_ETHER;
        uint256 expectedLiquidity = 100 * ONE_ETHER;

        mockPool.setExpectedAddLiquidityNonInitialValues(amountADesired, amountBDesired, expectedLiquidity);
        mockPool.setRevertAddLiquidityNonInitial(false, "");

        vm.expectCall(
            address(tokenA),
            abi.encodeWithSelector(IERC20.transferFrom.selector, alice, address(mockPool), amountADesired)
        );
        vm.expectCall(
            address(tokenB),
            abi.encodeWithSelector(IERC20.transferFrom.selector, alice, address(mockPool), amountBDesired)
        );

        (address poolToken0, ) = mockPool.tokens();
        uint256 expectedAmount0DesiredForPool;
        uint256 expectedAmount1DesiredForPool;

        if (address(tokenA) == poolToken0) {
            expectedAmount0DesiredForPool = amountADesired;
            expectedAmount1DesiredForPool = amountBDesired;
        } else {
            expectedAmount0DesiredForPool = amountBDesired;
            expectedAmount1DesiredForPool = amountADesired;
        }

        vm.expectCall(
            address(mockPool),
            abi.encodeWithSelector(IAetherPool.addLiquidityNonInitial.selector,
                                   bob_recipient,
                                   expectedAmount0DesiredForPool,
                                   expectedAmount1DesiredForPool,
                                   bytes(""))
        );

        vm.expectEmit(true, true, true, true, address(liquidityRouter));
        emit LiquidityRouter.LiquidityAdded(alice, address(tokenA), address(tokenB), address(mockPool), amountADesired, amountBDesired, expectedLiquidity);

        vm.startPrank(alice);
        LiquidityRouter.AddLiquidityParams memory params = LiquidityRouter.AddLiquidityParams({
            tokenA: address(tokenA),
            tokenB: address(tokenB),
            pool: address(mockPool),
            amountADesired: amountADesired,
            amountBDesired: amountBDesired,
            amountAMin: amountAMin,
            amountBMin: amountBMin,
            to: bob_recipient,
            deadline: block.timestamp + 60
        });
        (uint256 amountAActual, uint256 amountBActual, uint256 liquidityActual) = liquidityRouter.addLiquidity(params);
        vm.stopPrank();

        assertEq(amountAActual, amountADesired, "amountAActual mismatch");
        assertEq(amountBActual, amountBDesired, "amountBActual mismatch");
        assertEq(liquidityActual, expectedLiquidity, "liquidityActual mismatch");
    }

    function test_AddLiquidity_SlippageFailure_AmountA() public {
        uint256 amountADesired = 100 * ONE_ETHER;
        uint256 amountBDesired = 100 * ONE_ETHER;
        uint256 amountAMin = 101 * ONE_ETHER;
        uint256 amountBMin = 99 * ONE_ETHER;
        uint256 expectedLiquidity = 100 * ONE_ETHER;

        mockPool.setExpectedAddLiquidityNonInitialValues(amountADesired, amountBDesired, expectedLiquidity);
        mockPool.setRevertAddLiquidityNonInitial(false, "");

        vm.startPrank(alice);
        LiquidityRouter.AddLiquidityParams memory paramsSlippageA = LiquidityRouter.AddLiquidityParams({
            tokenA: address(tokenA),
            tokenB: address(tokenB),
            pool: address(mockPool),
            amountADesired: amountADesired,
            amountBDesired: amountBDesired,
            amountAMin: amountAMin,
            amountBMin: amountBMin,
            to: bob_recipient,
            deadline: block.timestamp + 60
        });
        vm.expectRevert(Errors.InsufficientAAmount.selector);
        liquidityRouter.addLiquidity(paramsSlippageA);
        vm.stopPrank();
    }

    function test_AddLiquidity_SlippageFailure_AmountB() public {
        uint256 amountADesired = 100 * ONE_ETHER;
        uint256 amountBDesired = 100 * ONE_ETHER;
        uint256 amountAMin = 99 * ONE_ETHER;
        uint256 amountBMin = 101 * ONE_ETHER;
        uint256 expectedLiquidity = 100 * ONE_ETHER;

        mockPool.setExpectedAddLiquidityNonInitialValues(amountADesired, amountBDesired, expectedLiquidity);
        mockPool.setRevertAddLiquidityNonInitial(false, "");

        vm.startPrank(alice);
        LiquidityRouter.AddLiquidityParams memory paramsSlippageB = LiquidityRouter.AddLiquidityParams({
            tokenA: address(tokenA),
            tokenB: address(tokenB),
            pool: address(mockPool),
            amountADesired: amountADesired,
            amountBDesired: amountBDesired,
            amountAMin: amountAMin,
            amountBMin: amountBMin,
            to: bob_recipient,
            deadline: block.timestamp + 60
        });
        vm.expectRevert(Errors.InsufficientBAmount.selector);
        liquidityRouter.addLiquidity(paramsSlippageB);
        vm.stopPrank();
    }

    function test_AddLiquidity_DeadlineExpired() public {
        uint256 amountADesired = 100 * ONE_ETHER;
        uint256 amountBDesired = 100 * ONE_ETHER;
        uint256 amountAMin = 99 * ONE_ETHER;
        uint256 amountBMin = 99 * ONE_ETHER;
        uint256 pastDeadline = block.timestamp - 1;

        vm.startPrank(alice);
        LiquidityRouter.AddLiquidityParams memory paramsDeadline = LiquidityRouter.AddLiquidityParams({
            tokenA: address(tokenA),
            tokenB: address(tokenB),
            pool: address(mockPool),
            amountADesired: amountADesired,
            amountBDesired: amountBDesired,
            amountAMin: amountAMin,
            amountBMin: amountBMin,
            to: bob_recipient,
            deadline: pastDeadline
        });
        vm.expectRevert(Errors.DeadlineExpired.selector);
        liquidityRouter.addLiquidity(paramsDeadline);
        vm.stopPrank();
    }

    function test_AddLiquidity_PoolReverts() public {
        uint256 amountADesired = 100 * ONE_ETHER;
        uint256 amountBDesired = 100 * ONE_ETHER;
        uint256 amountAMin = 99 * ONE_ETHER;
        uint256 amountBMin = 99 * ONE_ETHER;
        string memory revertMsg = "Pool: Custom Revert";

        mockPool.setRevertAddLiquidityNonInitial(true, revertMsg);

        vm.startPrank(alice);
        LiquidityRouter.AddLiquidityParams memory paramsPoolRevert = LiquidityRouter.AddLiquidityParams({
            tokenA: address(tokenA),
            tokenB: address(tokenB),
            pool: address(mockPool),
            amountADesired: amountADesired,
            amountBDesired: amountBDesired,
            amountAMin: amountAMin,
            amountBMin: amountBMin,
            to: bob_recipient,
            deadline: block.timestamp + 60
        });
        vm.expectRevert(bytes(revertMsg));
        liquidityRouter.addLiquidity(paramsPoolRevert);
        vm.stopPrank();
    }

    function test_AddLiquidity_InvalidPoolAddress() public {
        vm.startPrank(alice);
        LiquidityRouter.AddLiquidityParams memory paramsInvalidPool = LiquidityRouter.AddLiquidityParams({
            tokenA: address(tokenA),
            tokenB: address(tokenB),
            pool: address(0),
            amountADesired: 1,
            amountBDesired: 1,
            amountAMin: 0,
            amountBMin: 0,
            to: bob_recipient,
            deadline: block.timestamp + 60
        });
        vm.expectRevert(Errors.ZeroAddress.selector);
        liquidityRouter.addLiquidity(paramsInvalidPool);
        vm.stopPrank();
    }

    function test_AddLiquidity_TokenMismatch() public {
        MockERC20 tokenC = new MockERC20("TokenC", "TKNC", 18);
        vm.startPrank(alice);
        tokenC.mint(alice, 100 * ONE_ETHER);
        tokenC.approve(address(liquidityRouter), 100 * ONE_ETHER);

        vm.expectRevert(Errors.InvalidPath.selector);
        LiquidityRouter.AddLiquidityParams memory paramsTokenMismatch = LiquidityRouter.AddLiquidityParams({
            tokenA: address(tokenC),
            tokenB: address(tokenB),
            pool: address(mockPool),
            amountADesired: 100 * ONE_ETHER,
            amountBDesired: 100 * ONE_ETHER,
            amountAMin: 0,
            amountBMin: 0,
            to: bob_recipient,
            deadline: block.timestamp + 60
        });
        liquidityRouter.addLiquidity(paramsTokenMismatch);
        vm.stopPrank();
    }
}

contract ConcreteMockPool is ControllableMockIAetherPool {
}
