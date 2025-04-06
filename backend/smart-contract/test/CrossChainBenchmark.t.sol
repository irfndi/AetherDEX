// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.29;

import {Test} from "forge-std/Test.sol";
import {console2} from "forge-std/console2.sol";
import {stdStorage, StdStorage} from "forge-std/StdStorage.sol";
import {MockChainNetworks} from "./mocks/MockChainNetworks.sol";
import {MockERC20} from "./mocks/MockERC20.sol";
import {MockLayerZeroEndpoint} from "./mocks/MockLayerZeroEndpoint.sol";
import {MockPoolManager} from "./mocks/MockPoolManager.sol";
import {AetherPool} from "../src/AetherPool.sol";
import {AetherVault} from "../src/vaults/AetherVault.sol";
import {AetherStrategy} from "../src/vaults/AetherStrategy.sol";
import {AetherVaultFactory} from "../src/vaults/AetherVaultFactory.sol";
import {CrossChainLiquidityHook} from "../src/hooks/CrossChainLiquidityHook.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract CrossChainBenchmarkTest is Test {
    using stdStorage for StdStorage;

    MockChainNetworks public networks;
    mapping(uint16 => mapping(string => uint256)) public gasUsage;
    mapping(uint16 => AetherVault) public vaults;
    mapping(uint16 => MockLayerZeroEndpoint) public lzEndpoints;
    mapping(uint16 => MockPoolManager) public poolManagers;

    address public user = address(0x1);
    uint256 constant TEST_AMOUNT = 100 ether;
    uint256 constant GWEI = 1e9;

    function setUp() public {
        networks = new MockChainNetworks();
        _setupChains();
    }

    function _setupChains() internal {
        uint16[10] memory allChains = [
            networks.ETHEREUM_CHAIN_ID(),
            networks.BSC_CHAIN_ID(),
            networks.ARBITRUM_CHAIN_ID(),
            networks.OPTIMISM_CHAIN_ID(),
            networks.POLYGON_CHAIN_ID(),
            networks.AVALANCHE_CHAIN_ID(),
            networks.BASE_CHAIN_ID(),
            networks.ZKSYNC_CHAIN_ID(),
            networks.LINEA_CHAIN_ID(),
            networks.POLYGON_ZKEVM_CHAIN_ID()
        ];

        // Deploy infrastructure on all chains
        for (uint256 i = 0; i < allChains.length; i++) {
            uint16 chainId = allChains[i];
            _setupSingleChain(chainId);
        }

        // Connect all chains
        for (uint256 i = 0; i < allChains.length; i++) {
            for (uint256 j = i + 1; j < allChains.length; j++) {
                _connectChains(allChains[i], allChains[j]);
            }
        }
    }

    function _setupSingleChain(uint16 chainId) internal {
        // Deploy mock tokens for the pool
        MockERC20 token0 = new MockERC20("Token0", "TKN0", 18);
        MockERC20 token1 = new MockERC20("Token1", "TKN1", 18);
        
        // Create a pool with the factory address (this test contract)
        AetherPool pool = new AetherPool(address(this));
        pool.initialize(address(token0), address(token1), uint24(3000)); // Removed last argument

        // Setup pool manager with the initialized pool and no hook
        MockPoolManager poolManager = new MockPoolManager(address(0)); // Pass only hook address
        poolManagers[chainId] = poolManager;

        // Setup endpoint and vault
        MockLayerZeroEndpoint endpoint = new MockLayerZeroEndpoint();
        lzEndpoints[chainId] = endpoint;

        AetherVaultFactory factory = new AetherVaultFactory(
            address(poolManager),
            address(endpoint)
        );

        (address vault, address strategy) = factory.deployVault(
            networks.getNativeToken(chainId),
            "Aether Benchmark Vault", 
            "aBMV"
        );
        vaults[chainId] = AetherVault(vault);        

        // Fund user
        networks.mintNativeToken(chainId, user, 10000 ether);
    }

    function _connectChains(uint16 chainA, uint16 chainB) internal {
        require(chainA != chainB, "Cannot connect chain to itself");
        require(address(lzEndpoints[chainA]) != address(0), "Endpoint A not initialized");
        require(address(lzEndpoints[chainB]) != address(0), "Endpoint B not initialized");
        
        lzEndpoints[chainA].setRemoteEndpoint(chainB, address(lzEndpoints[chainB]));
        lzEndpoints[chainB].setRemoteEndpoint(chainA, address(lzEndpoints[chainA]));
        
        // Verify connection
        require(
            lzEndpoints[chainA].remoteEndpoints(chainB) == address(lzEndpoints[chainB]),
            "Failed to set remote endpoint"
        );
    }

    function test_GasBenchmarkByChain() public {
        uint16[10] memory chains = [
            networks.ETHEREUM_CHAIN_ID(),
            networks.BSC_CHAIN_ID(),
            networks.ARBITRUM_CHAIN_ID(),
            networks.OPTIMISM_CHAIN_ID(),
            networks.POLYGON_CHAIN_ID(),
            networks.AVALANCHE_CHAIN_ID(),
            networks.BASE_CHAIN_ID(),
            networks.ZKSYNC_CHAIN_ID(),
            networks.LINEA_CHAIN_ID(),
            networks.POLYGON_ZKEVM_CHAIN_ID()
        ];

        for (uint256 i = 0; i < chains.length; i++) {
            uint16 chainId = chains[i];
            _benchmarkChain(chainId);
            
            string memory chainName;
            uint256 blockTime;
            uint256 baseFee;
            address[] memory tokens;
            (chainName, blockTime, baseFee, tokens) = networks.getChainInfo(chainId);
            
            // Log results
            console2.log("\nGas Benchmark for Chain:", chainName);
            console2.log("Base Fee (gwei):", baseFee / GWEI);
            console2.log("Block Time:", blockTime, "seconds");
            console2.log("Deposit Gas:", gasUsage[chainId]["deposit"]);
            console2.log("Withdraw Gas:", gasUsage[chainId]["withdraw"]);
            console2.log("Cross-Chain Gas:", gasUsage[chainId]["crossChain"]);
            
            // Calculate costs in USD (assuming ETH = $3000)
            uint256 gasPrice = baseFee;
            uint256 ethPrice = 3000e18; // $3000 per ETH
            uint256 depositCost = (gasUsage[chainId]["deposit"] * gasPrice * ethPrice) / 1e36;
            uint256 withdrawCost = (gasUsage[chainId]["withdraw"] * gasPrice * ethPrice) / 1e36;
            uint256 crossChainCost = (gasUsage[chainId]["crossChain"] * gasPrice * ethPrice) / 1e36;
            
            console2.log("Estimated Costs (USD):");
            console2.log("Deposit: $", depositCost);
            console2.log("Withdraw: $", withdrawCost);
            console2.log("Cross-Chain: $", crossChainCost);
        }
    }

    function _benchmarkChain(uint16 chainId) internal {
        AetherVault vault = vaults[chainId];
        require(address(vault) != address(0), "Vault not initialized");
        
        address token = networks.getNativeToken(chainId);
        require(token != address(0), "Token not initialized");
        
        uint256 initialBalance = IERC20(token).balanceOf(user);
        require(initialBalance >= TEST_AMOUNT, "Insufficient initial balance");
        
        console2.log("\nStarting benchmark for chain:", chainId);
        console2.log("Initial token balance:", initialBalance / 1 ether, "ETH");
        
        vm.startPrank(user);
        
        // Benchmark deposit
        MockERC20(token).approve(address(vault), TEST_AMOUNT);
        uint256 gasBefore = gasleft();
        vault.deposit(TEST_AMOUNT, user);
        gasUsage[chainId]["deposit"] = gasBefore - gasleft();

        // Benchmark withdraw
        gasBefore = gasleft();
        vault.withdraw(TEST_AMOUNT / 2, user, user);
        gasUsage[chainId]["withdraw"] = gasBefore - gasleft();

        // Benchmark cross-chain operation - find first connected chain
        gasBefore = gasleft();
        bytes memory crossChainData = abi.encode(user, TEST_AMOUNT / 4);
        console2.log("Preparing cross-chain transfer of", TEST_AMOUNT / 4 / 1 ether, "tokens");

        // Find first connected destination chain
        uint16 destChainId;
        for (uint16 i = 0; i < 1000; i++) {
            if (i != chainId && lzEndpoints[chainId].remoteEndpoints(i) != address(0)) {
                destChainId = i;
                break;
            }
        }
        require(destChainId != 0, "No connected chains found");
        
        try lzEndpoints[chainId].estimateFees(
            destChainId,
            address(vault),
            crossChainData,
            false,
            ""
        ) returns (uint256 nativeFee, uint256 zroFee) {
            console2.log("Estimated fees:", nativeFee / 1 ether, "ETH");
            uint256 estimatedGas = nativeFee;
            
        // Fund user with enough native token for gas
        vm.deal(user, estimatedGas * 2);
        
        try lzEndpoints[chainId].send{value: estimatedGas}(
            destChainId,
            abi.encodePacked(address(vault)),
            crossChainData,
            payable(user),
            address(0),
            ""
        ) {
                console2.log("Cross-chain transfer successful");
            } catch Error(string memory reason) {
                console2.log("Cross-chain send failed:", reason);
                revert(reason);
            } catch (bytes memory) {
                console2.log("Cross-chain send failed with unknown error");
                revert("Cross-chain send failed");
            }
        } catch Error(string memory reason) {
            console2.log("Fee estimation failed:", reason);
            revert(reason);
        } catch (bytes memory) {
            console2.log("Fee estimation failed with unknown error");
            revert("Fee estimation failed");
        }
        
        gasUsage[chainId]["crossChain"] = gasBefore - gasleft();

        vm.stopPrank();
    }

    function test_PerformanceComparison() public {
        // Setup benchmark data
        uint256[] memory depositAmounts = new uint256[](5);
        depositAmounts[0] = 1 ether;
        depositAmounts[1] = 10 ether;
        depositAmounts[2] = 100 ether;
        depositAmounts[3] = 1000 ether;
        depositAmounts[4] = 10000 ether;

        uint16[3] memory testChains = [
            networks.ETHEREUM_CHAIN_ID(),    // High gas, slow
            networks.ARBITRUM_CHAIN_ID(),    // Low gas, fast
            networks.OPTIMISM_CHAIN_ID()     // Medium gas, medium speed
        ];

        for (uint256 i = 0; i < testChains.length; i++) {
            uint16 chainId = testChains[i];
            string memory chainName;
            uint256 blockTime;
            uint256 baseFee;
            address[] memory tokens;
            (chainName, blockTime, baseFee, tokens) = networks.getChainInfo(chainId);

            console2.log("\nPerformance Analysis for", chainName);
            console2.log("Block Time:", blockTime);
            console2.log("Base Fee:", baseFee);

            for (uint256 j = 0; j < depositAmounts.length; j++) {
                _benchmarkAmount(chainId, depositAmounts[j]);
            }
        }
    }

    function _benchmarkAmount(uint16 chainId, uint256 amount) internal {
        AetherVault vault = vaults[chainId];
        address token = networks.getNativeToken(chainId);

        // Ensure user has enough tokens
        uint256 balance = IERC20(token).balanceOf(user);
        if (balance < amount) {
            networks.mintNativeToken(chainId, user, amount - balance);
        }

        vm.startPrank(user);
        MockERC20(token).approve(address(vault), amount);

        uint256 gasBefore = gasleft();
        vault.deposit(amount, user);
        uint256 gasUsed = gasBefore - gasleft();

        console2.log("Amount:", amount / 1 ether, "ETH");
        console2.log("Gas Used:", gasUsed);
        console2.log("Gas per ETH:", gasUsed / (amount / 1 ether));

        vm.stopPrank();
    }

    receive() external payable {}
}
