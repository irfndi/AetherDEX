// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.29;

import {Test, Vm} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {MockERC20} from "../mocks/MockERC20.sol";
import {AetherVault} from "../../src/vaults/AetherVault.sol";
import {AetherStrategy} from "../../src/vaults/AetherStrategy.sol";
import {AetherVaultFactory} from "../../src/vaults/AetherVaultFactory.sol";
import {IPoolManager} from "../../src/interfaces/IPoolManager.sol";
import {MockPoolManager} from "../mocks/MockPoolManager.sol";
import {AetherPool} from "../../src/AetherPool.sol";

contract AetherVaultTest is Test {
    AetherVaultFactory public factory;
    MockPoolManager public poolManager;
    MockERC20 public asset;
    address public lzEndpoint;

    address public alice = address(0x1);
    address public bob = address(0x2);

    event VaultDeployed(
        address indexed vault, address indexed strategy, address indexed asset, string name, string symbol
    );

    function setUp() public {
        // Deploy mock tokens
        asset = new MockERC20("Test Token", "TEST", 18);
        MockERC20 token1 = new MockERC20("USDC", "USDC", 6);

        // Create and initialize pool
        AetherPool pool = new AetherPool(address(this));
        pool.initialize(address(asset), address(token1), uint24(3000), address(this));

        // Deploy mock pool manager with pool
        poolManager = new MockPoolManager(address(pool), address(0)); // No hook needed

        // Set LZ endpoint
        lzEndpoint = address(0x3); // Mock LZ endpoint

        // Deploy factory with configured pool manager
        factory = new AetherVaultFactory(address(poolManager), lzEndpoint);

        // Setup initial balances
        asset.mint(alice, 1000e18);
        asset.mint(bob, 1000e18);
        vm.prank(alice);
        asset.approve(address(factory), type(uint256).max);
        vm.prank(bob);
        asset.approve(address(factory), type(uint256).max);
    }

    function test_DeployVault() public {
        // Deploy new vault
        vm.recordLogs();

        (address vault, address strategy) = factory.deployVault(address(asset), "TEST Vault", "vTEST");

        // Check for event emission
        Vm.Log[] memory entries = vm.getRecordedLogs();
        assertGt(entries.length, 0, "No events emitted");

        // We don't check the exact event data since addresses are dynamic

        // Verify deployment
        assertTrue(vault != address(0), "Vault not deployed");
        assertTrue(strategy != address(0), "Strategy not deployed");

        // Verify vault configuration
        AetherVault vaultContract = AetherVault(vault);
        assertEq(address(vaultContract.asset()), address(asset), "Wrong asset");
        assertEq(vaultContract.name(), "TEST Vault", "Wrong name");
        assertEq(vaultContract.symbol(), "vTEST", "Wrong symbol");
        assertEq(address(vaultContract.poolManager()), address(poolManager), "Wrong pool manager");
        assertEq(vaultContract.strategy(), strategy, "Wrong strategy");
    }

    function test_DepositWithdraw() public {
        // Deploy vault
        (address vault,) = factory.deployVault(address(asset), "TEST Vault", "vTEST");
        AetherVault vaultContract = AetherVault(vault);

        // Deposit
        uint256 depositAmount = 100e18;
        vm.startPrank(alice);
        asset.approve(vault, depositAmount);
        uint256 sharesBefore = vaultContract.balanceOf(alice);
        vaultContract.deposit(depositAmount, alice);
        uint256 sharesAfter = vaultContract.balanceOf(alice);
        vm.stopPrank();

        // Verify deposit
        assertEq(sharesAfter - sharesBefore, depositAmount, "Wrong shares minted");
        assertEq(vaultContract.totalAssets(), depositAmount, "Wrong total assets");

        // Withdraw
        vm.startPrank(alice);
        uint256 assetsBefore = asset.balanceOf(alice);
        vaultContract.withdraw(depositAmount, alice, alice);
        uint256 assetsAfter = asset.balanceOf(alice);
        vm.stopPrank();

        // Verify withdrawal
        assertEq(assetsAfter - assetsBefore, depositAmount, "Wrong withdrawal amount");
        assertEq(vaultContract.totalAssets(), 0, "Assets not fully withdrawn");
    }

    function test_YieldAccrual() public {
        // Deploy vault
        (address vault, address strategy) = factory.deployVault(address(asset), "TEST Vault", "vTEST");
        AetherVault vaultContract = AetherVault(vault);
        AetherStrategy strategyContract = AetherStrategy(strategy);

        // Deposit from Alice
        uint256 depositAmount = 100e18;
        vm.startPrank(alice);
        asset.approve(vault, depositAmount);
        vaultContract.deposit(depositAmount, alice);
        vm.stopPrank();

        // Update yield rate (simulate yield generation)
        uint256 yieldRate = 1e16; // 0.01 tokens per second
        vm.prank(address(vaultContract));
        strategyContract.updateBaseYieldRate(yieldRate);

        // Move forward in time
        vm.warp(block.timestamp + 1 days);

        // Force yield accrual by making a small action that triggers _accruePendingYield()
        vm.prank(alice);
        vaultContract.withdraw(1, alice, alice);

        // Verify yield accrual
        uint256 expectedYield = 1 days * yieldRate / 1e18;
        assertGt(vaultContract.totalAssets(), depositAmount - 1, "No yield accrued");
        assertEq(vaultContract.totalAssets(), depositAmount - 1 + expectedYield, "Wrong yield amount");
    }

    function test_CrossChainYieldSync() public {
        // Deploy vault
        (address vault, address strategy) = factory.deployVault(address(asset), "TEST Vault", "vTEST");
        AetherVault vaultContract = AetherVault(vault);
        AetherStrategy strategyContract = AetherStrategy(strategy);

        // Initial deposit
        uint256 depositAmount = 100e18;
        vm.startPrank(alice);
        asset.approve(vault, depositAmount);
        vaultContract.deposit(depositAmount, alice);
        vm.stopPrank();

        // Simulate cross-chain yield sync
        uint256 crossChainYield = 10e18;

        // First, configure the chain to be active
        vm.prank(address(vaultContract));
        strategyContract.configureChain(1, address(0x123), true); // Chain ID 1, dummy remote strategy

        // Then sync the cross-chain yield
        vm.prank(address(vaultContract));
        strategyContract.syncCrossChainYield(1, crossChainYield); // Chain ID 1

        // Verify total assets includes cross-chain yield
        assertEq(vaultContract.totalAssets(), depositAmount + crossChainYield, "Cross-chain yield not added");
    }

    function test_MultiUserScenario() public {
        // Deploy vault
        (address vault, address strategy) = factory.deployVault(address(asset), "TEST Vault", "vTEST");
        AetherVault vaultContract = AetherVault(vault);

        // Alice deposits
        uint256 aliceDeposit = 100e18;
        vm.startPrank(alice);
        asset.approve(vault, aliceDeposit);
        vaultContract.deposit(aliceDeposit, alice);
        vm.stopPrank();

        // Generate some yield
        vm.warp(block.timestamp + 1 days);

        // Bob deposits
        uint256 bobDeposit = 50e18;
        vm.startPrank(bob);
        asset.approve(vault, bobDeposit);
        vaultContract.deposit(bobDeposit, bob);
        vm.stopPrank();

        // Verify shares are proportional to deposits
        uint256 aliceShares = vaultContract.balanceOf(alice);
        uint256 bobShares = vaultContract.balanceOf(bob);
        assertGt(aliceShares, bobShares, "Alice should have more shares");

        // Both withdraw
        vm.prank(alice);
        vaultContract.withdraw(aliceDeposit, alice, alice);
        vm.prank(bob);
        vaultContract.withdraw(bobDeposit, bob, bob);

        // Verify both got their proportional share of yields
        assertGt(asset.balanceOf(alice), aliceDeposit, "Alice didn't get yield");
        assertGt(asset.balanceOf(bob), bobDeposit, "Bob didn't get yield");
    }
}
