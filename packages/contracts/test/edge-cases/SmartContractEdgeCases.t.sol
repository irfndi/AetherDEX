// SPDX-License-Identifier: MIT
pragma solidity ^0.8.31;

import "forge-std/Test.sol";
import "../../src/primary/AetherRouter.sol";
import "../../src/primary/AetherFactory.sol";
import "../../src/primary/FeeRegistry.sol";
import "../../src/interfaces/IAetherPool.sol";
import "../../src/libraries/Errors.sol";
import "../mocks/MockERC20.sol";
import "../mocks/MockPoolManager.sol";
import "../mocks/MockCCIPRouter.sol";
import "../mocks/MockHyperlane.sol";

/**
 * @title SmartContractEdgeCasesTest
 * @notice Comprehensive edge case testing for AetherDEX smart contracts
 * @dev Adapted for Hybrid Architecture (Vyper Pool + Solidity Router/Factory)
 */
contract SmartContractEdgeCasesTest is Test {
    AetherRouter public router;
    AetherFactory public factory;
    FeeRegistry public feeRegistry;
    MockERC20 public token0;
    MockERC20 public token1;

    // Mocks to satisfy constructor deps
    MockPoolManager public mockPoolManager;

    address public constant USER = address(0x1);
    address public constant ATTACKER = address(0x2);

    uint24 public constant POOL_FEE = 3000; // 0.3%

    function setUp() public {
        // Deploy tokens
        token0 = new MockERC20("Token0", "TK0", 18);
        token1 = new MockERC20("Token1", "TK1", 18);

        // Ensure consistent ordering
        if (address(token0) > address(token1)) {
            (token0, token1) = (token1, token0);
        }

        // Deploy infrastructure
        feeRegistry = new FeeRegistry(address(this), address(this), 500);
        factory = new AetherFactory(address(this), address(feeRegistry), POOL_FEE);
        router = new AetherRouter(address(factory));

        // Setup initial balances
        token0.mint(USER, 1_000_000 ether);
        token1.mint(USER, 1_000_000 ether);
        token0.mint(ATTACKER, 1_000_000 ether);
        token1.mint(ATTACKER, 1_000_000 ether);

        // Approve router
        vm.startPrank(USER);
        token0.approve(address(router), type(uint256).max);
        token1.approve(address(router), type(uint256).max);
        vm.stopPrank();

        vm.startPrank(ATTACKER);
        token0.approve(address(router), type(uint256).max);
        token1.approve(address(router), type(uint256).max);
        vm.stopPrank();
    }

    // ============ MOCK POOL DEPLOYMENT HELPER ============
    // Since we don't have the Vyper compiler in this test environment natively without ffi,
    // we will simulate the pool interactions by deploying a MockPool that behaves like the Vyper pool
    // OR we rely on the fact that we can't easily deploy the Vyper pool here without vm.deployCode
    // pointing to the artifact.
    // However, since we enabled AetherPool.vy, we can try to deploy it if the build process generated artifacts.
    // Given the environment constraints, using a MockPool that adheres to the IAetherPool interface
    // is often safer for edge case logic testing of the Router.
    // BUT, we want to test the actual interaction.
    // Let's use the MockPool strategy similar to SwapRouterTest but robust enough for these checks.

    // Actually, AetherFactory.createPool calls create2 with bytecode.
    // In strict foundry tests, if we don't have the Vyper artifact, this fails.
    // So we will Register a pool manually for these tests.

    function _setupPoolWithLiquidity(uint256 amount0, uint256 amount1) internal returns (address pool) {
        // Deploy a MockPool that simulates AetherPool.vy behavior
        MockPool mockPool = new MockPool();
        mockPool.initialize(address(token0), address(token1), POOL_FEE);

        // Register it
        factory.registerPool(address(mockPool), address(token0), address(token1));
        pool = address(mockPool);

        // Add liquidity via Router
        vm.startPrank(USER);
        router.addLiquidity(address(token0), address(token1), amount0, amount1, 0, 0, USER, block.timestamp + 100);
        vm.stopPrank();
    }

    // ============ EDGE CASES ============

    function testPrecisionLossInSmallSwaps() public {
        address pool = _setupPoolWithLiquidity(1000 ether, 1000 ether);

        vm.startPrank(USER);

        uint256 amountIn = 1; // 1 wei

        // Path
        address[] memory path = new address[](2);
        path[0] = address(token0);
        path[1] = address(token1);

        // This should either revert with InsufficientOutputAmount or return 0
        // Our Router checks amountOut < amountOutMin
        // 1 * (1000000 - 3000) = 997000.
        // 1000e18 * 1000000 + 997000 approx 1e24.
        // 997000 * 1000e18 / 1e24 = 0.
        // So amountOut will be 0.

        // If amountOutMin is 0, it might pass with 0 output?
        // BaseRouter: if (amountOut < minAmountOut) revert Errors.InsufficientOutputAmount();
        // If minAmountOut is 0, 0 < 0 is false. So it passes.
        // But transferring 0 tokens might fail or be weird?
        // Let's expect 0 output.

        uint256[] memory amounts = router.swapExactTokensForTokens(amountIn, 0, path, USER, block.timestamp + 100);

        assertEq(amounts[1], 0, "Tiny swap should result in zero output due to precision");

        vm.stopPrank();
    }

    function testSwapWithZeroAmount() public {
        _setupPoolWithLiquidity(1000 ether, 1000 ether);

        vm.startPrank(USER);

        address[] memory path = new address[](2);
        path[0] = address(token0);
        path[1] = address(token1);

        vm.expectRevert(Errors.InvalidAmountIn.selector); // Router validation
        router.swapExactTokensForTokens(0, 0, path, USER, block.timestamp + 100);

        vm.stopPrank();
    }

    function testSwapToZeroAddress() public {
        // Router doesn't explicitly check "to" != 0 in swapExactTokensForTokens
        // But ERC20 transfer will fail or Pool logic will fail.
        // Let's check interaction.
        _setupPoolWithLiquidity(1000 ether, 1000 ether);

        vm.startPrank(USER);
        address[] memory path = new address[](2);
        path[0] = address(token0);
        path[1] = address(token1);

        // MockPool usually calls transfer(to, amount).
        // OpenZeppelin ERC20 reverts on transfer to zero address.

        vm.expectRevert(); // Expect some revert from token transfer
        router.swapExactTokensForTokens(1 ether, 0, path, address(0), block.timestamp + 100);

        vm.stopPrank();
    }
}

// Minimal MockPool for Edge Case testing (aligned with AetherPool.vy logic + Router expectations)
contract MockPool is IAetherPool {
    address public token0;
    address public token1;
    uint24 public fee;
    uint256 public reserve0Val;
    uint256 public reserve1Val;
    uint256 public totalSupplyVal;

    bool public initialized;

    function initialize(address _token0, address _token1, uint24 _fee) external override {
        token0 = _token0;
        token1 = _token1;
        fee = _fee;
        initialized = true;
    }

    function tokens() external view override returns (address, address) {
        return (token0, token1);
    }

    // NOTE: Public variables `token0` and `token1` automatically generate getters
    // that conflict with explicit `token0()` and `token1()` functions.
    // Since we need to implement IAetherPool which requires `token0()` and `token1()`,
    // the public variables already satisfy this interface requirement.
    // Explicit functions removed.

    function reserve0() external view override returns (uint256) {
        return reserve0Val;
    }

    function reserve1() external view override returns (uint256) {
        return reserve1Val;
    }

    function totalSupply() external view override returns (uint256) {
        return totalSupplyVal;
    }

    function addInitialLiquidity(uint256 amount0Desired, uint256 amount1Desired)
        external
        override
        returns (uint256 liquidity)
    {
        // Simulate pulling tokens (Router already sent them, or we assume they are there for mock)
        // In real Vyper pool, it transfersFrom.
        // Here we just update state.
        reserve0Val = amount0Desired;
        reserve1Val = amount1Desired;
        liquidity = 1000; // Dummy
        totalSupplyVal = liquidity;
        return liquidity;
    }

    function addLiquidityNonInitial(address, uint256 amount0Desired, uint256 amount1Desired, bytes calldata)
        external
        override
        returns (uint256 amount0Actual, uint256 amount1Actual, uint256 liquidityMinted)
    {
        reserve0Val += amount0Desired;
        reserve1Val += amount1Desired;
        liquidityMinted = 1000;
        totalSupplyVal += liquidityMinted;
        return (amount0Desired, amount1Desired, liquidityMinted);
    }

    function swap(uint256 amountIn, address tokenIn, address to) external override returns (uint256 amountOut) {
        // Basic CPMM logic to facilitate testing
        bool isToken0 = tokenIn == token0;
        uint256 reserveIn = isToken0 ? reserve0Val : reserve1Val;
        uint256 reserveOut = isToken0 ? reserve1Val : reserve0Val;

        uint256 amountInWithFee = amountIn * (1000000 - fee);
        uint256 numerator = amountInWithFee * reserveOut;
        uint256 denominator = (reserveIn * 1000000) + amountInWithFee;
        amountOut = numerator / denominator;

        // Update reserves (simulated)
        if (isToken0) {
            reserve0Val += amountIn;
            reserve1Val -= amountOut;
        } else {
            reserve1Val += amountIn;
            reserve0Val -= amountOut;
        }

        // Transfer out
        address tokenOut = isToken0 ? token1 : token0;
        MockERC20(tokenOut).mint(to, amountOut); // Mint to simulate transfer for mock

        return amountOut;
    }

    function mint(address, uint128) external pure override returns (uint256, uint256) {
        return (0, 0);
    }

    function burn(address, uint256) external pure override returns (uint256, uint256) {
        return (0, 0);
    }

    // Implement transfer for LP token logic in Router (which calls IERC20(pool).transfer)
    // Since MockPool doesn't inherit ERC20, we need to mock this
    function transfer(address to, uint256 amount) external returns (bool) {
        // Mock transfer logic
        return true;
    }
}
