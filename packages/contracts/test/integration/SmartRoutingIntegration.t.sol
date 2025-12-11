// SPDX-License-Identifier: GPL-3.0

/*
Created by irfndi (github.com/irfndi) - Apr 2025
Email: join.mantap@gmail.com
*/

pragma solidity ^0.8.31;

import {Test} from "forge-std/Test.sol";
import {console2} from "forge-std/console2.sol";
import {IERC20} from "forge-std/interfaces/IERC20.sol";
import {MockChainNetworks} from "../mocks/MockChainNetworks.sol";
import {MockERC20} from "../mocks/MockERC20.sol";
import {MockAetherPool} from "../mocks/MockAetherPool.sol";
import {AetherRouterCrossChain} from "../../src/primary/AetherRouterCrossChain.sol";
import {IAetherPool} from "../../src/interfaces/IAetherPool.sol";
import {MockCCIPRouter} from "../mocks/MockCCIPRouter.sol";
import {MockHyperlane} from "../mocks/MockHyperlane.sol";
import {FeeRegistry} from "../../src/primary/FeeRegistry.sol";
import {MockPoolManager} from "../mocks/MockPoolManager.sol";
import {AetherVaultFactory} from "../../src/vaults/AetherVaultFactory.sol";
import {IPoolManager, PoolKey} from "../../src/interfaces/IPoolManager.sol";
import "../../src/interfaces/ICCIPRouter.sol";
import "../../src/interfaces/IHyperlane.sol";

contract SmartRoutingIntegrationTest is Test {
    // Core contracts
    MockChainNetworks internal networks;
    AetherRouterCrossChain internal router;
    MockCCIPRouter internal ccipRouter;
    MockHyperlane internal hyperlane;
    FeeRegistry internal feeRegistry;

    // Chain-specific mappings
    mapping(uint16 => mapping(address => mapping(address => address))) internal pools;
    mapping(uint16 => address) internal poolManagers;
    mapping(uint16 => address) public chainSpecificTokenA;
    mapping(uint16 => address) public chainSpecificTokenB;
    mapping(uint16 => mapping(address => uint256)) internal gasUsage;
    mapping(uint16 => uint256) internal crossChainCosts;

    // Test users
    address payable public deployer;
    address payable public user;
    address payable public alice;
    address payable public bob;

    // Test constants
    uint256 internal constant INITIAL_LIQUIDITY_PER_TOKEN = 1000000 ether;
    uint16 constant DEFAULT_FEE_TIER = 3000;
    int24 constant DEFAULT_TICK_SPACING = 60;
    uint256 constant SWAP_AMOUNT = 1000 ether;

    address public weth;
    address public usdc;
    address public matic;
    address public usdt;

    uint16[] public SUPPORTED_CHAINS;

    event SwapExecuted(address tokenIn, address tokenOut, uint256 amountIn, uint256 amountOut);
    event CrossChainSwapInitiated(uint16 srcChain, uint16 dstChain, uint256 amount);

    function setUp() public {
        deployer = payable(address(this));
        vm.startPrank(deployer);

        user = payable(vm.addr(1_000_000_000));
        alice = payable(vm.addr(2_000_000_000));
        bob = payable(vm.addr(3_000_000_000));

        networks = new MockChainNetworks();

        // Deploy mock tokens
        weth = address(new MockERC20("Wrapped Ether", "WETH", 18));
        usdc = address(new MockERC20("USD Coin", "USDC", 6));
        matic = address(new MockERC20("Matic", "MATIC", 18));
        usdt = address(new MockERC20("Tether", "USDT", 6));

        // Initialize SUPPORTED_CHAINS array
        SUPPORTED_CHAINS = new uint16[](4);
        SUPPORTED_CHAINS[0] = networks.ETHEREUM_CHAIN_ID();
        SUPPORTED_CHAINS[1] = networks.POLYGON_CHAIN_ID();
        SUPPORTED_CHAINS[2] = networks.ARBITRUM_CHAIN_ID();
        SUPPORTED_CHAINS[3] = networks.OPTIMISM_CHAIN_ID();

        for (uint256 i = 0; i < SUPPORTED_CHAINS.length; i++) {
            _initializeTokensAndPoolsForChain(SUPPORTED_CHAINS[i]);

            // Add initial liquidity to the pools
            _addInitialLiquidity(
                SUPPORTED_CHAINS[i],
                chainSpecificTokenA[SUPPORTED_CHAINS[i]] == address(0)
                    ? weth
                    : chainSpecificTokenA[SUPPORTED_CHAINS[i]],
                chainSpecificTokenB[SUPPORTED_CHAINS[i]] == address(0)
                    ? usdc
                    : chainSpecificTokenB[SUPPORTED_CHAINS[i]],
                pools[SUPPORTED_CHAINS[i]][(weth < usdc ? weth : usdc)][(weth < usdc ? usdc : weth)]
            );
        }
        _deployRoutersAndBridges();
        _setupCrossChainRoutes(SUPPORTED_CHAINS);

        // Set initial approvals and mint for test users
        vm.label(user, "User");
        vm.label(alice, "Alice");
        vm.label(bob, "Bob");

        // Fund users (example)
        MockERC20(weth).mint(user, 10000 ether);
        MockERC20(usdc).mint(user, 10000 * 10 ** 6);
        MockERC20(weth).mint(alice, 10000 ether);
        MockERC20(usdc).mint(alice, 10000 * 10 ** 6);
        MockERC20(weth).mint(bob, 10000 ether);
        MockERC20(usdc).mint(bob, 10000 * 10 ** 6);

        vm.stopPrank();

        router.setTestMode(true);
    }

    function _initializeTokensAndPoolsForChain(uint16 chainId) internal {
        address tokenA;
        address tokenB;

        if (chainId == networks.ETHEREUM_CHAIN_ID()) {
            tokenA = weth; // Use the globally defined WETH for Ethereum
            tokenB = usdc; // Use the globally defined USDC for Ethereum
        } else {
            // For other chains, create new mock token instances
            string memory tokenAName = string.concat(string.concat("ChainTokenA-", vm.toString(chainId)), "-TKA");
            string memory tokenASymbol = string.concat("TKA-", vm.toString(chainId));
            tokenA = address(new MockERC20(tokenAName, tokenASymbol, 18));
            chainSpecificTokenA[chainId] = tokenA; // Store for later use

            string memory tokenBName = string.concat(string.concat("ChainTokenB-", vm.toString(chainId)), "-TKB");
            string memory tokenBSymbol = string.concat("TKB-", vm.toString(chainId));
            tokenB = address(new MockERC20(tokenBName, tokenBSymbol, 18));
            chainSpecificTokenB[chainId] = tokenB; // Store for later use

            vm.label(tokenA, tokenAName);
            vm.label(tokenB, tokenBName);
        }

        address orderedTokenA = tokenA < tokenB ? tokenA : tokenB;
        address orderedTokenB = tokenA < tokenB ? tokenB : tokenA;

        address poolAddress;
        if (chainId == networks.ETHEREUM_CHAIN_ID()) {
            // Deploy actual MockAetherPool for Ethereum
            poolAddress = address(new MockAetherPool(orderedTokenA, orderedTokenB, DEFAULT_FEE_TIER));
            console2.log("Deployed MockAetherPool for ETH at:", poolAddress);
        } else {
            // Use a deterministic placeholder address for the pool itself for other chains
            poolAddress = address(
                uint160(uint256(keccak256(abi.encodePacked("pool_placeholder", chainId, orderedTokenA, orderedTokenB))))
            );
            console2.log("Using placeholder pool for chain:", vm.toString(chainId));
            console2.log("  TokenA:", orderedTokenA, " TokenB:", orderedTokenB);
            console2.log("  Pool Addr:", poolAddress);
        }
        pools[chainId][orderedTokenA][orderedTokenB] = poolAddress;
        pools[chainId][orderedTokenB][orderedTokenA] = poolAddress; // For reverse lookup
        // router.addTrustedPoolForChain(chainId, poolAddress, orderedTokenA, orderedTokenB); // Commented out: function doesn't exist on router
    }

    function _deployRoutersAndBridges() internal {
        ccipRouter = new MockCCIPRouter();
        hyperlane = new MockHyperlane();
        feeRegistry = new FeeRegistry(address(this), address(this), 500);

        // Deploy router with messaging integration
        router = new AetherRouterCrossChain(
            address(this),
            address(ccipRouter),
            address(hyperlane),
            address(new MockERC20("LINK", "LINK", 18)),
            address(new MockPoolManager(address(0))),
            address(this),
            500
        );
    }

    function _setupCrossChainRoutes(uint16[] memory chains) internal {
        for (uint256 i = 0; i < chains.length; i++) {
            for (uint256 j = i + 1; j < chains.length; j++) {
                ccipRouter.setLane(chains[i], chains[j], true);
                hyperlane.setRoute(chains[i], chains[j], true);
            }
        }
    }

    function _addInitialLiquidity(uint16 chainId, address tokenA, address tokenB, address poolAddress) internal {
        if (chainId == networks.ETHEREUM_CHAIN_ID()) {
            // Only interact with MockAetherPool for Ethereum chain
            MockAetherPool pool = MockAetherPool(payable(poolAddress));
            // Mint some initial tokens to 'alice' (or the test contract itself) to provide liquidity
            deal(tokenA, alice, INITIAL_LIQUIDITY_PER_TOKEN);
            deal(tokenB, alice, INITIAL_LIQUIDITY_PER_TOKEN);

            vm.startPrank(alice);
            IERC20(tokenA).approve(address(pool), INITIAL_LIQUIDITY_PER_TOKEN);
            IERC20(tokenB).approve(address(pool), INITIAL_LIQUIDITY_PER_TOKEN);
            // Assuming MockAetherPool's addInitialLiquidity takes amounts for tokenA and tokenB
            pool.addInitialLiquidity(INITIAL_LIQUIDITY_PER_TOKEN, INITIAL_LIQUIDITY_PER_TOKEN);
            vm.stopPrank();
            // console2.log("Added initial liquidity to ETH pool:", poolAddress, "for tokens", tokenA, tokenB); // Temporarily commented out
        } else {
            // For non-ETH chains, we don't have a real pool contract to add liquidity to.
            // The test setup implies these pools exist and have liquidity, handled by mock values.
            // We can simulate minting tokens to a conceptual 'liquidity_provider' for these chains if needed
            // but for now, the placeholder pool address is enough to structure the routes.
            console2.log("Skipping actual liquidity addition for placeholder pool on chain:", vm.toString(chainId));
        }
    }

    struct TestParams {
        uint16[] path;
        address tokenIn;
        address tokenOut;
        uint256 amountIn;
        uint256 amountOutMin;
        address recipient;
        uint256 deadline;
        uint256 expectedAmountOut;
    }

    // Test setup helper for one-hop cross-chain swap
    function _setupCrossChainTestOneHop() internal view returns (TestParams memory params) {
        params.path = new uint16[](2);
        params.path[0] = networks.ETHEREUM_CHAIN_ID();
        params.path[1] = networks.ARBITRUM_CHAIN_ID();

        params.tokenIn = weth;
        // For Arbitrum, get the specific mock token B we created for it
        params.tokenOut = chainSpecificTokenB[params.path[1]];
        params.amountIn = SWAP_AMOUNT;
        params.amountOutMin = 0;
        params.recipient = bob;
        params.deadline = block.timestamp + 1 days;
        params.expectedAmountOut = params.amountIn * 98 / 100;
        return params;
    }

    function _setupCrossChainTestTwoHops() internal view returns (TestParams memory params) {
        params.path = new uint16[](3);
        params.path[0] = networks.ETHEREUM_CHAIN_ID();
        params.path[1] = networks.ARBITRUM_CHAIN_ID();
        params.path[2] = networks.OPTIMISM_CHAIN_ID();

        params.tokenIn = weth;
        // Final tokenOut is on Optimism (path[2]), using its specific mock token B
        params.tokenOut = chainSpecificTokenB[params.path[2]];
        params.amountIn = SWAP_AMOUNT;
        params.amountOutMin = 0;
        params.recipient = bob;
        params.deadline = block.timestamp + 1 days;
        // Rough expectation: 2% fee per hop. ETH->ARB (98%), ARB->OP (98% of previous)
        params.expectedAmountOut = (params.amountIn * 98 / 100) * 98 / 100;
        return params;
    }

    function test_CrossChain_OneHop_ETH_ARB() public {
        TestParams memory params = _setupCrossChainTestOneHop();
        _setupAliceTokens(params);

        vm.startPrank(alice);
        IERC20(params.tokenIn).approve(address(router), params.amountIn);

        (uint256 aliceInitialBalance, uint256 routerInitialBalance) = _recordInitialBalances(params.tokenIn);
        _setupMockCalls();

        bool callSuccess = _executeCrossChainRoute(aliceInitialBalance, routerInitialBalance);
        assertTrue(callSuccess, "Cross-chain route execution should succeed");

        vm.stopPrank();
    }

    function _setupAliceTokens(TestParams memory params) private {
        deal(address(params.tokenIn), alice, params.amountIn);
        vm.deal(alice, 1 ether);
    }

    function _recordInitialBalances(address tokenIn)
        private
        view
        returns (uint256 aliceBalance, uint256 routerBalance)
    {
        aliceBalance = IERC20(tokenIn).balanceOf(alice);
        routerBalance = IERC20(tokenIn).balanceOf(address(router));
    }

    function _setupMockCalls() private {
        // Mock CCIP router calls
        bytes32 mockCcipMessageId = bytes32(uint256(1));
        vm.mockCall(
            address(ccipRouter), abi.encodeWithSelector(ccipRouter.estimateFees.selector), abi.encode(0.05 ether)
        );
        vm.mockCall(address(ccipRouter), abi.encodeWithSelector(ccipRouter.depositToken.selector), abi.encode(true));
        vm.mockCall(
            address(ccipRouter), abi.encodeWithSelector(ccipRouter.sendMessage.selector), abi.encode(mockCcipMessageId)
        );

        // Mock Hyperlane calls
        bytes32 mockHyperlaneMessageId = bytes32(uint256(2));
        vm.mockCall(
            address(hyperlane), abi.encodeWithSelector(hyperlane.quoteDispatch.selector), abi.encode(0.04 ether)
        );
        vm.mockCall(address(hyperlane), abi.encodeWithSelector(hyperlane.depositToken.selector), abi.encode(true));
        vm.mockCall(
            address(hyperlane), abi.encodeWithSelector(hyperlane.dispatch.selector), abi.encode(mockHyperlaneMessageId)
        );
    }

    function _executeCrossChainRoute(uint256 aliceInitialBalance, uint256 routerInitialBalance)
        private
        returns (bool callSuccess)
    {
        address tokenInDirect = address(weth);
        address tokenOutDirect = address(usdc);
        uint256 amountInDirect = 1 ether;
        uint256 amountOutMinDirect = amountInDirect * 95 / 100;

        deal(tokenInDirect, alice, amountInDirect);
        IERC20(tokenInDirect).approve(address(router), amountInDirect);
        vm.deal(address(router), 5 ether);

        try router.executeCrossChainRoute{value: 0.05 ether}(
            tokenInDirect,
            tokenOutDirect,
            amountInDirect,
            amountOutMinDirect,
            alice,
            networks.ETHEREUM_CHAIN_ID(),
            networks.ARBITRUM_CHAIN_ID(),
            ""
        ) {
            callSuccess = true;
            console2.log("Cross-chain route execution succeeded!");

            uint256 aliceFinalBalance = IERC20(tokenInDirect).balanceOf(alice);
            uint256 routerFinalBalance = IERC20(tokenInDirect).balanceOf(address(router));

            console2.log("Alice initial balance:", aliceInitialBalance);
            console2.log("Alice final balance:", aliceFinalBalance);
            console2.log("Router final balance:", routerFinalBalance);

            assertTrue(aliceFinalBalance < aliceInitialBalance, "Alice's balance should decrease");
            assertTrue(routerFinalBalance > routerInitialBalance, "Router's balance should increase");
        } catch Error(string memory reason) {
            console2.log("Cross-chain route execution reverted with reason:", reason);
        } catch (bytes memory lowLevelData) {
            console2.log("Cross-chain route execution reverted with low-level data:", vm.toString(lowLevelData));
        }
    }

    function test_CrossChain_TwoHops_ETH_ARB_OP() public {
        TestParams memory params = _setupCrossChainTestTwoHops();

        // User (Alice) needs tokenIn and ETH
        deal(address(params.tokenIn), alice, params.amountIn);
        vm.deal(alice, 1 ether); // Make sure Alice has enough ETH
        vm.deal(address(router), 5 ether); // Ensure router has ETH for internal operations

        vm.startPrank(alice);
        IERC20(params.tokenIn).approve(address(router), params.amountIn);

        // Record initial balances
        uint256 aliceInitialBalance = IERC20(params.tokenIn).balanceOf(alice);

        // Mock CCIP router calls
        bytes32 mockCcipMessageId = bytes32(uint256(10));
        vm.mockCall(
            address(ccipRouter), abi.encodeWithSelector(ccipRouter.estimateFees.selector), abi.encode(0.05 ether)
        );

        vm.mockCall(address(ccipRouter), abi.encodeWithSelector(ccipRouter.depositToken.selector), abi.encode(true));

        vm.mockCall(
            address(ccipRouter), abi.encodeWithSelector(ccipRouter.sendMessage.selector), abi.encode(mockCcipMessageId)
        );

        // Mock Hyperlane calls
        bytes32 mockHyperlaneMessageId = bytes32(uint256(20));
        vm.mockCall(
            address(hyperlane), abi.encodeWithSelector(hyperlane.quoteDispatch.selector), abi.encode(0.04 ether)
        );

        vm.mockCall(address(hyperlane), abi.encodeWithSelector(hyperlane.depositToken.selector), abi.encode(true));

        vm.mockCall(
            address(hyperlane), abi.encodeWithSelector(hyperlane.dispatch.selector), abi.encode(mockHyperlaneMessageId)
        );

        // Prepare test path
        uint16[] memory testPath = new uint16[](3);
        testPath[0] = networks.ETHEREUM_CHAIN_ID();
        testPath[1] = networks.ARBITRUM_CHAIN_ID();
        testPath[2] = networks.OPTIMISM_CHAIN_ID();

        address tokenInDirect = address(weth);
        address tokenOutDirect = address(usdc);
        uint256 amountInDirect = 1 ether;
        uint256 amountOutMinDirect = 0;
        address recipientDirect = alice;

        deal(tokenInDirect, alice, amountInDirect);
        IERC20(tokenInDirect).approve(address(router), amountInDirect);

        // Empty route data for simplicity
        bytes[] memory routeData = new bytes[](testPath.length - 1);

        bool callSuccess = false;

        try router.executeMultiPathRoute{value: 0.15 ether}(
            tokenInDirect, tokenOutDirect, amountInDirect, amountOutMinDirect, recipientDirect, testPath, routeData
        ) returns (
            uint256 amountOut
        ) {
            callSuccess = true;
            console2.log("Multi-hop cross-chain route succeeded, amountOut:", amountOut);

            // Check balances after execution
            uint256 aliceFinalBalance = IERC20(tokenInDirect).balanceOf(alice);

            // Log the balances for debugging
            console2.log("Alice initial balance:", aliceInitialBalance);
            console2.log("Alice final balance:", aliceFinalBalance);

            // Just verify that Alice has less tokens
            assertTrue(aliceFinalBalance < aliceInitialBalance, "Alice's balance should decrease");
        } catch Error(string memory reason) {
            console2.log("Multi-hop cross-chain route reverted with reason:", reason);
        } catch (bytes memory lowLevelData) {
            console2.log("Multi-hop cross-chain route reverted with low-level data:", vm.toString(lowLevelData));
        }

        assertTrue(callSuccess, "Multi-hop cross-chain route should succeed");

        vm.stopPrank();
    }

    receive() external payable {}
}
