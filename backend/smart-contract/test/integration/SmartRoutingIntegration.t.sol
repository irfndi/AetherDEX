// SPDX-License-Identifier: GPL-3.0

/*
Created by irfndi (github.com/irfndi) - Apr 2025
Email: join.mantap@gmail.com
*/

pragma solidity ^0.8.29;

import {Test} from "forge-std/Test.sol";
import {console2} from "forge-std/console2.sol";
import {MockChainNetworks} from "../mocks/MockChainNetworks.sol";
import {MockERC20} from "../mocks/MockERC20.sol";
import {ICCIPRouter} from "../../src/interfaces/ICCIPRouter.sol";
import {IHyperlane} from "../../src/interfaces/IHyperlane.sol";
import {AetherRouterCrossChain} from "../../src/primary/AetherRouterCrossChain.sol";
import {IAetherPool} from "../../src/interfaces/IAetherPool.sol";
import {MockCCIPRouter} from "../mocks/MockCCIPRouter.sol";
import {MockHyperlane} from "../mocks/MockHyperlane.sol";
import {FeeRegistry} from "../../src/primary/FeeRegistry.sol";
import {MockPoolManager} from "../mocks/MockPoolManager.sol";
import {AetherVaultFactory} from "../../src/vaults/AetherVaultFactory.sol";
import {IPoolManager, PoolKey} from "../../src/interfaces/IPoolManager.sol";

contract SmartRoutingIntegrationTest is Test {
    // Core contracts
    MockChainNetworks public networks;
    AetherRouterCrossChain public router;
    MockCCIPRouter public ccipRouter;
    MockHyperlane public hyperlane;
    FeeRegistry public feeRegistry;

    // Chain-specific mappings
    mapping(uint16 => address) public pools;
    mapping(uint16 => address) public poolManagers;
    mapping(uint16 => mapping(address => uint256)) public gasUsage;
    mapping(uint16 => uint256) public crossChainCosts;

    // Test users
    address public alice = address(0x1);
    address public bob = address(0x2);

    // Test constants
    uint256 constant INITIAL_LIQUIDITY = 1000000 ether;
    uint24 constant DEFAULT_FEE = 3000; // 0.3%
    uint256 constant SWAP_AMOUNT = 1000 ether;

    event SwapExecuted(address tokenIn, address tokenOut, uint256 amountIn, uint256 amountOut);
    event CrossChainSwapInitiated(uint16 srcChain, uint16 dstChain, uint256 amount);

    function setUp() public {
        networks = new MockChainNetworks();
        ccipRouter = new MockCCIPRouter();
        hyperlane = new MockHyperlane();
        feeRegistry = new FeeRegistry(address(this)); // Pass initialOwner

        _setupInfrastructure();
        _fundTestUsers();
    }

    function _setupInfrastructure() internal {
        uint16[] memory testChains = new uint16[](3);
        testChains[0] = networks.ETHEREUM_CHAIN_ID();
        testChains[1] = networks.ARBITRUM_CHAIN_ID();
        testChains[2] = networks.OPTIMISM_CHAIN_ID();

        // Create mock pool and poolManager for router initialization
        MockPoolManager initialManager = new MockPoolManager(address(0)); // Pass only hook address

        // Deploy router with messaging integration
        router = new AetherRouterCrossChain(
            address(this), // owner
            address(ccipRouter),
            address(hyperlane),
            address(new MockERC20("LINK", "LINK", 18)),
            address(initialManager), // poolManager
            address(this), // factory - using 'this' as placeholder
            500 // maxSlippage - 5%
        );

        // Enable test mode to bypass EOA check
        router.setTestMode(true);

        for (uint256 i = 0; i < testChains.length; i++) {
            _setupChainInfrastructure(testChains[i]);
        }

        _setupCrossChainRoutes(testChains);
    }

    function _setupChainInfrastructure(uint16 chainId) internal {
        address token0 = networks.getNativeToken(chainId);
        address token1 = address(new MockERC20("USDC", "USDC", 6));

        // Ensure token0 < token1 for consistent ordering
        if (uint160(token0) > uint160(token1)) {
            (token0, token1) = (token1, token0);
        }

        // Use placeholder pool address
        address placeholderPoolAddress = address(uint160(address(0)) + 0x100 + chainId); // Use base address + offset for unique placeholder

        // Deploy pool manager with initialized pool
        MockPoolManager manager = new MockPoolManager(address(0)); // Pass only hook address
        poolManagers[chainId] = address(manager);

        // Create pool key and register placeholder
        PoolKey memory key = PoolKey({
            token0: token0,
            token1: token1,
            fee: DEFAULT_FEE,
            tickSpacing: 60, // Assume default
            hooks: address(0)
        });
        bytes32 poolId = keccak256(abi.encode(key));
        manager.setPool(poolId, placeholderPoolAddress);

        // Store the placeholder address
        pools[chainId] = placeholderPoolAddress;

        _addInitialLiquidity(chainId, token0, token1, placeholderPoolAddress);
    }

    function _setupCrossChainRoutes(uint16[] memory chains) internal {
        for (uint256 i = 0; i < chains.length; i++) {
            for (uint256 j = i + 1; j < chains.length; j++) {
                ccipRouter.setLane(chains[i], chains[j], true);
                hyperlane.setRoute(chains[i], chains[j], true);
            }
        }
    }

    function _addInitialLiquidity(uint16, /* chainId */ address token0, address token1, address pool) internal {
        MockERC20(token0).mint(address(this), INITIAL_LIQUIDITY);
        MockERC20(token1).mint(address(this), INITIAL_LIQUIDITY);

        MockERC20(token0).approve(pool, INITIAL_LIQUIDITY);
        MockERC20(token1).approve(pool, INITIAL_LIQUIDITY);

        // TODO: Add liquidity via PoolManager or update test logic
        // IAetherPool(pool).mint(address(this), INITIAL_LIQUIDITY, INITIAL_LIQUIDITY); // Old incompatible call
    }

    function _fundTestUsers() internal {
        deal(alice, 100 ether);
        deal(bob, 100 ether);
    }

    struct TestParams {
        uint16 chainId;
        address pool;
        address token0;
        address token1;
        uint256 amountIn;
        uint256 amountOut;
        bytes routeData;
    }

    function test_SingleChainRoute() public {
        TestParams memory params = _setupSingleChainTest();

        vm.startPrank(alice);
        MockERC20(params.token0).mint(alice, SWAP_AMOUNT);
        MockERC20(params.token0).approve(address(router), SWAP_AMOUNT);

        vm.recordLogs();
        // Correct executeRoute signature: (tokenIn, tokenOut, amountIn, amountOutMin, fee, deadline)
        // Assuming amountOut is the minimum acceptable output for this test
        // Assuming DEFAULT_FEE and block.timestamp for fee and deadline
        router.executeRoute(
            params.token0,
            params.token1,
            params.amountIn,
            params.amountOut, // Using amountOut as amountOutMin for this test
            DEFAULT_FEE, // Pass fee
            block.timestamp // Pass deadline
        );

        assertTrue(MockERC20(params.token0).balanceOf(alice) == 0, "Token0 not spent");
        assertTrue(MockERC20(params.token1).balanceOf(alice) >= params.amountOut, "Insufficient output");
        vm.stopPrank();
    }

    function _setupSingleChainTest() internal view returns (TestParams memory) {
        TestParams memory params;
        params.chainId = networks.ETHEREUM_CHAIN_ID();
        params.pool = pools[params.chainId];
        (params.token0, params.token1) = IAetherPool(params.pool).tokens();
        params.amountIn = SWAP_AMOUNT;

        // Get optimal route
        (params.amountOut, params.routeData) =
            router.getOptimalRoute(params.token0, params.token1, params.amountIn, params.chainId);
        return params;
    }

    function test_CrossChainRoute_OptimalPath() public {
        uint16 srcChain = networks.ETHEREUM_CHAIN_ID();
        uint16 dstChain = networks.ARBITRUM_CHAIN_ID();

        address srcPool = pools[srcChain];
        address dstPool = pools[dstChain];
        (address srcToken0, ) = IAetherPool(srcPool).tokens();
        (, address dstToken1) = IAetherPool(dstPool).tokens();
        address token0 = srcToken0;
        address token1 = dstToken1;

        vm.startPrank(alice);
        MockERC20(token0).mint(alice, SWAP_AMOUNT);
        MockERC20(token0).approve(address(router), SWAP_AMOUNT);

        // Get cross-chain route with optimal bridge selection
        (uint256 expectedOut, bytes memory routeData, bool useCCIP) =
            router.getCrossChainRoute(token0, token1, SWAP_AMOUNT, srcChain, dstChain);

        // Calculate bridge fee
        uint256 bridgeFee =
            useCCIP ? ccipRouter.estimateFees(dstChain, address(router), "") : hyperlane.quoteDispatch(dstChain, "");

        // Execute cross-chain swap
        vm.recordLogs();
        router.executeCrossChainRoute{value: bridgeFee}(
            token0, token1, SWAP_AMOUNT, expectedOut, alice, srcChain, dstChain, routeData
        );

        // Verify cross-chain message delivery
        assertTrue(
            ccipRouter.messageDelivered(srcChain, dstChain) || hyperlane.isVerified(srcChain, dstChain),
            "Cross-chain message failed"
        );

        vm.stopPrank();
    }

    function test_MultiPathRoute_GasOptimization() public {
        uint16[] memory path = new uint16[](3);
        path[0] = networks.ETHEREUM_CHAIN_ID();
        path[1] = networks.ARBITRUM_CHAIN_ID();
        path[2] = networks.OPTIMISM_CHAIN_ID();

        address srcPool = pools[path[0]];
        address dstPool = pools[path[2]];
        (address srcToken0, ) = IAetherPool(srcPool).tokens();
        (, address dstToken1) = IAetherPool(dstPool).tokens();
        address token0 = srcToken0;
        address token1 = dstToken1;

        vm.startPrank(alice);
        MockERC20(token0).mint(alice, SWAP_AMOUNT);
        MockERC20(token0).approve(address(router), SWAP_AMOUNT);

        // Get multi-path route with gas optimization
        (uint256[] memory amounts, bytes[] memory routeData, uint256 totalBridgeFee) =
            router.getMultiPathRoute(token0, token1, SWAP_AMOUNT, path);

        // Record gas usage before
        uint256 gasBefore = gasleft();

        // Execute multi-path swap
        router.executeMultiPathRoute{value: totalBridgeFee}(
            token0, token1, SWAP_AMOUNT, amounts[amounts.length - 1], alice, path, routeData
        );

        // Record gas usage after
        uint256 gasUsed = gasBefore - gasleft();
        gasUsage[path[0]][token0] = gasUsed;

        // Verify messages were delivered through optimal paths
        for (uint256 i = 0; i < path.length - 1; i++) {
            assertTrue(
                ccipRouter.messageDelivered(path[i], path[i + 1]) || hyperlane.isVerified(path[i], path[i + 1]),
                "Cross-chain message failed"
            );
        }

        vm.stopPrank();
    }

    function test_BridgeSelection_LowestFee() public view {
        uint16 srcChain = networks.ETHEREUM_CHAIN_ID();
        uint16 dstChain = networks.ARBITRUM_CHAIN_ID();

        // Get fees from both bridges
        uint256 ccipFee = ccipRouter.estimateFees(dstChain, address(router), "");

        uint256 hyperlaneFee = hyperlane.quoteDispatch(dstChain, "");

        // Get route with bridge selection
        address mockTokenIn = networks.getNativeToken(srcChain);
        address mockTokenOut = networks.getNativeToken(dstChain);
        (,, bool useCCIP) = router.getCrossChainRoute(mockTokenIn, mockTokenOut, SWAP_AMOUNT, srcChain, dstChain);

        // Verify optimal bridge selection
        if (ccipFee <= hyperlaneFee) {
            assertTrue(useCCIP, "Should select CCIP for lower fee");
        } else {
            assertFalse(useCCIP, "Should select Hyperlane for lower fee");
        }
    }

    receive() external payable {}
}
