// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.29;

import {Test} from "forge-std/Test.sol";
import {MockChainNetworks} from "./mocks/MockChainNetworks.sol";
import {MockERC20} from "./mocks/MockERC20.sol";
import {MockLayerZeroEndpoint} from "./mocks/MockLayerZeroEndpoint.sol";
import {AetherVault} from "../src/vaults/AetherVault.sol";
import {AetherStrategy} from "../src/vaults/AetherStrategy.sol";
import {AetherVaultFactory} from "../src/vaults/AetherVaultFactory.sol";
import {MockPoolManager} from "./mocks/MockPoolManager.sol";
import {CrossChainLiquidityHook} from "../src/hooks/CrossChainLiquidityHook.sol";
import {IPoolManager} from "../src/interfaces/IPoolManager.sol";
import {AetherPool} from "../src/AetherPool.sol";

contract CrossChainIntegrationTest is Test {
    MockChainNetworks public networks;
    mapping(uint16 => AetherVaultFactory) public factories;
    mapping(uint16 => MockPoolManager) public poolManagers;
    mapping(uint16 => CrossChainLiquidityHook) public hooks;
    mapping(uint16 => MockLayerZeroEndpoint) public lzEndpoints;

    address public alice = address(0x1);
    address public bob = address(0x2);

    function setUp() public {
        // Deploy network simulations
        networks = new MockChainNetworks();

        // Setup each chain's infrastructure
        uint16[3] memory testChains = [
            networks.ETHEREUM_CHAIN_ID(),
            networks.ARBITRUM_CHAIN_ID(),
            networks.OPTIMISM_CHAIN_ID()
        ];

        for (uint256 i = 0; i < testChains.length; i++) {
            uint16 chainId = testChains[i];
            
            // Create mock tokens
            address token0 = networks.getNativeToken(chainId);
            address token1 = address(new MockERC20("USDC", "USDC", 6));

            // Deploy and initialize pool
            AetherPool pool = new AetherPool(address(this));
            pool.initialize(token0, token1, uint24(3000), address(this));

            // Setup LayerZero endpoint
            MockLayerZeroEndpoint lzEndpoint = new MockLayerZeroEndpoint();
            lzEndpoints[chainId] = lzEndpoint;

            // Deploy pool manager first
            // Assuming MockPoolManager constructor doesn't strictly need the final hook address immediately
            poolManagers[chainId] = new MockPoolManager(address(pool), address(0)); // Placeholder hook address

            // Deploy and configure hook, passing the actual poolManager address
            hooks[chainId] = new CrossChainLiquidityHook(address(poolManagers[chainId]), address(lzEndpoint));

            // If MockPoolManager needs the real hook address set after deployment, do it here
            // Example: poolManagers[chainId].setHook(address(hooks[chainId])); // Uncomment if needed

            // Deploy factory with configured pool manager and endpoint
            factories[chainId] = new AetherVaultFactory(address(poolManagers[chainId]), address(lzEndpoint));

            // Setup trusted remote for LayerZero
            lzEndpoint.setTrustedRemote(address(hooks[chainId]), true);

            // Fund test accounts
            networks.mintNativeToken(chainId, alice, 1000 ether);
            networks.mintNativeToken(chainId, bob, 1000 ether);
        }

        // Connect chains via LayerZero
        _setupCrossChainConnections(testChains);
    }

    function _setupCrossChainConnections(uint16[3] memory chains) internal {
        for (uint256 i = 0; i < chains.length; i++) {
            for (uint256 j = 0; j < chains.length; j++) {
                if (i != j) {
                    // Set up bidirectional connection between chains
                    lzEndpoints[chains[i]].setRemoteEndpoint(chains[j], address(lzEndpoints[chains[j]]));
                    lzEndpoints[chains[j]].setRemoteEndpoint(chains[i], address(lzEndpoints[chains[i]]));
                    
                    // Configure hooks to recognize each other
                    vm.prank(address(poolManagers[chains[i]]));
                    hooks[chains[i]].setRemoteHook(chains[j], address(hooks[chains[j]]));
                    
                    vm.prank(address(poolManagers[chains[j]]));
                    hooks[chains[j]].setRemoteHook(chains[i], address(hooks[chains[i]]));
                }
            }
        }
    }

    function test_CrossChainVaultDeployment() public {
        uint16[3] memory testChains = [
            networks.ETHEREUM_CHAIN_ID(),
            networks.ARBITRUM_CHAIN_ID(),
            networks.OPTIMISM_CHAIN_ID()
        ];

        // Deploy vaults on each chain
        for (uint256 i = 0; i < testChains.length; i++) {
            uint16 chainId = testChains[i];
            address nativeToken = networks.getNativeToken(chainId);

            (address vault, address strategy) = factories[chainId].deployVault(
                nativeToken,
                "Aether Native Token Vault",
                string.concat("aV", MockERC20(nativeToken).symbol())
            );

            assertTrue(vault != address(0), "Vault deployment failed");
            assertTrue(strategy != address(0), "Strategy deployment failed");

            // Verify vault configuration
            AetherVault vaultContract = AetherVault(vault);
            assertEq(address(vaultContract.asset()), nativeToken, "Wrong asset");
            assertEq(address(vaultContract.strategy()), strategy, "Wrong strategy");
        }
    }

    function test_CrossChainVaultInteraction() public {
        // Setup vaults on Ethereum and Arbitrum
        uint16 ethereumChainId = networks.ETHEREUM_CHAIN_ID();
        uint16 arbitrumChainId = networks.ARBITRUM_CHAIN_ID();

        // Deploy ETH vault on Ethereum
        (address ethVault,) = factories[ethereumChainId].deployVault(
            networks.getNativeToken(ethereumChainId),
            "Aether ETH Vault",
            "aVETH"
        );

        // Deploy ETH vault on Arbitrum
        (address arbVault,) = factories[arbitrumChainId].deployVault(
            networks.getNativeToken(arbitrumChainId),
            "Aether ARB ETH Vault",
            "aVETH"
        );

        // Alice deposits on Ethereum
        vm.startPrank(alice);
        MockERC20(networks.getNativeToken(ethereumChainId)).approve(ethVault, 100 ether);
        AetherVault(ethVault).deposit(100 ether, alice);
        vm.stopPrank();

        // Bob deposits on Arbitrum
        vm.startPrank(bob);
        MockERC20(networks.getNativeToken(arbitrumChainId)).approve(arbVault, 50 ether);
        AetherVault(arbVault).deposit(50 ether, bob);
        vm.stopPrank();

        // Verify deposits on both chains
        assertEq(AetherVault(ethVault).balanceOf(alice), 100 ether, "Wrong ETH vault balance");
        assertEq(AetherVault(arbVault).balanceOf(bob), 50 ether, "Wrong ARB vault balance");
    }

    function test_MultiChainYieldGeneration() public {
        uint16[3] memory testChains = [
            networks.ETHEREUM_CHAIN_ID(),
            networks.ARBITRUM_CHAIN_ID(),
            networks.OPTIMISM_CHAIN_ID()
        ];

        address[] memory vaults = new address[](testChains.length);
        uint256[] memory initialTVLs = new uint256[](testChains.length);

        // Deploy and fund vaults on each chain
        for (uint256 i = 0; i < testChains.length; i++) {
            uint16 chainId = testChains[i];
            address nativeToken = networks.getNativeToken(chainId);

            (address vault,) = factories[chainId].deployVault(
                nativeToken,
                "Aether Multi-Chain Vault",
                string.concat("aMCV", MockERC20(nativeToken).symbol())
            );
            vaults[i] = vault;

            // Alice deposits on each chain
            vm.startPrank(alice);
            MockERC20(nativeToken).approve(vault, 100 ether);
            AetherVault(vault).deposit(100 ether, alice);
            vm.stopPrank();

            initialTVLs[i] = AetherVault(vault).totalAssets();
        }

        // Simulate yield generation across chains
        for (uint256 i = 0; i < testChains.length; i++) {
            // Fast forward time and simulate yield
            vm.warp(block.timestamp + 1 days);
            
            AetherVault vault = AetherVault(vaults[i]);
            uint256 currentTVL = vault.totalAssets();
            assertTrue(currentTVL > initialTVLs[i], "No yield generated");
        }
    }

    function test_CrossChainLiquidityRebalancing() public {
        uint16 srcChain = networks.ETHEREUM_CHAIN_ID();
        uint16 dstChain = networks.ARBITRUM_CHAIN_ID();

        // Deploy vaults on both chains
        (address srcVault,) = factories[srcChain].deployVault(
            networks.getNativeToken(srcChain),
            "Aether ETH Source Vault",
            "aVETH"
        );

        (address dstVault,) = factories[dstChain].deployVault(
            networks.getNativeToken(dstChain),
            "Aether ETH Destination Vault",
            "aVETH"
        );

        // Set up cross-chain hooks
        vm.prank(address(poolManagers[srcChain]));
        hooks[srcChain].setRemoteHook(dstChain, address(hooks[dstChain]));
        vm.prank(address(poolManagers[dstChain]));
        hooks[dstChain].setRemoteHook(srcChain, address(hooks[srcChain]));

        // Initial liquidity on source chain
        vm.startPrank(alice);
        MockERC20(networks.getNativeToken(srcChain)).approve(srcVault, 100 ether);
        AetherVault(srcVault).deposit(100 ether, alice);
        vm.stopPrank();

        // Verify liquidity sync across chains
        assertEq(AetherVault(srcVault).totalAssets(), 100 ether, "Wrong source TVL");
        assertTrue(AetherVault(dstVault).totalAssets() > 0, "No liquidity synced to destination");
    }

    receive() external payable {}
}
