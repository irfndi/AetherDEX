// SPDX-License-Identifier: GPL-3.0

/*
Created by irfndi (github.com/irfndi) - Apr 2025
Email: join.mantap@gmail.com
*/

pragma solidity ^0.8.31;

import {Test, Vm} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {MockERC20} from "../mocks/MockERC20.sol";
import {AetherVault} from "../../src/vaults/AetherVault.sol";
import {AetherStrategy} from "../../src/vaults/AetherStrategy.sol";
import {AetherVaultFactory} from "../../src/vaults/AetherVaultFactory.sol";
import {IPoolManager} from "../../src/interfaces/IPoolManager.sol";
import {IAetherPool} from "../../src/interfaces/IAetherPool.sol";
import {MockPoolManager} from "../mocks/MockPoolManager.sol";

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
        IAetherPool pool = IAetherPool(address(0)); // Initialize with dummy address

        // Deploy mock pool manager with pool
        poolManager = new MockPoolManager(address(0)); // Pass only hook address

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

        // Use new return names from factory
        (address vaultAddress, address trueStrategyAddress) = factory.deployVault(address(asset), "TEST Vault", "vTEST");

        // Check for event emission
        Vm.Log[] memory entries = vm.getRecordedLogs();
        assertGt(entries.length, 0, "No events emitted");

        // We don't check the exact event data since addresses are dynamic

        // Verify deployment
        assertTrue(vaultAddress != address(0), "Vault not deployed");
        assertTrue(trueStrategyAddress != address(0), "Strategy not deployed");

        // Verify vault configuration
        AetherVault vaultContract = AetherVault(vaultAddress);
        assertEq(address(vaultContract.asset()), address(asset), "Wrong asset");
        assertEq(vaultContract.name(), "TEST Vault", "Wrong name");
        assertEq(vaultContract.symbol(), "vTEST", "Wrong symbol");
        assertEq(address(vaultContract.poolManager()), address(poolManager), "Wrong pool manager");

        // Vault's strategy field should now store the trueStrategyAddress directly
        assertEq(vaultContract.strategy(), trueStrategyAddress, "Vault strategy address mismatch");
    }

    function test_DepositWithdraw() public {
        // Deploy vault
        (address vaultAddress,) = factory.deployVault(address(asset), "TEST Vault", "vTEST"); // Get vaultAddress
        AetherVault vaultContract = AetherVault(vaultAddress);

        // Deposit
        uint256 depositAmount = 100e18;
        vm.startPrank(alice);
        asset.approve(address(vaultContract), depositAmount); // Approve the vault contract address
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
        // Use new return names from factory
        (address vaultAddress, address trueStrategyAddress) = factory.deployVault(address(asset), "TEST Vault", "vTEST");
        AetherVault vaultContract = AetherVault(vaultAddress);
        // Instantiate strategy contract with its true (unflagged) address
        AetherStrategy strategyContract = AetherStrategy(trueStrategyAddress);

        // Deposit from Alice
        uint256 depositAmount = 100e18;
        vm.startPrank(alice);
        asset.approve(address(vaultContract), depositAmount); // Approve the vault contract address
        vaultContract.deposit(depositAmount, alice);
        vm.stopPrank();

        // Update yield rate (simulate yield generation)
        uint256 yieldRate = 1e16; // 0.01 tokens per second
        vm.prank(address(vaultContract)); // AetherStrategy.updateBaseYieldRate expects vault as caller
        strategyContract.updateBaseYieldRate(yieldRate);

        // Move forward in time
        vm.warp(block.timestamp + 1 days);

        // Force yield accrual by making a small action that triggers _accruePendingYield()
        vm.startPrank(alice);
        // Attempt to withdraw 1 wei of asset. Preview how many shares that is.
        uint256 sharesForOneWei = vaultContract.previewWithdraw(1);
        if (sharesForOneWei > 0 && vaultContract.balanceOf(alice) >= sharesForOneWei) {
            vaultContract.withdraw(1, alice, alice); // Withdraw 1 wei of asset
        } else if (vaultContract.balanceOf(alice) > 0) {
            // If 1 wei is too small to get any shares, or not enough shares, try redeeming 1 share.
            vaultContract.redeem(1, alice, alice);
        }
        // If Alice has no shares, this part of the test won't change assets/yield related to her position.
        vm.stopPrank();

        uint256 currentTotalAssets = vaultContract.totalAssets();
        uint256 baseAssets = IERC20(vaultContract.asset()).balanceOf(address(vaultContract));
        uint256 calculatedTotalYield = vaultContract.totalYieldGenerated();

        // Verify yield accrual
        // AetherVault.yieldRate is X * 1e18 (yield per second, scaled)
        // Contract calculates: (timeElapsed * yieldRate) / 1e18
        // Test set yieldRate = 1e16. This is the value that should be used in the contract's formula.
        uint256 expectedYield = (1 days * yieldRate) / 1e18;

        assertGt(calculatedTotalYield, 0, "No yield accrued (totalYieldGenerated is zero)");
        // Check totalYieldGenerated for approximate equality.
        assertApproxEqAbs(calculatedTotalYield, expectedYield, 2, "Wrong yield amount based on totalYieldGenerated");
        // Also check that totalAssets reflects this yield on top of physical balance
        assertApproxEqAbs(
            currentTotalAssets, baseAssets + calculatedTotalYield, 2, "totalAssets != baseAssets + totalYieldGenerated"
        );
    }

    function test_CrossChainYieldSync() public {
        // Deploy vault
        // Use new return names from factory
        (address vaultAddress, address trueStrategyAddress) = factory.deployVault(address(asset), "TEST Vault", "vTEST");
        AetherVault vaultContract = AetherVault(vaultAddress);
        // Instantiate strategy contract with its true (unflagged) address
        AetherStrategy strategyContract = AetherStrategy(trueStrategyAddress);

        // Initial deposit
        uint256 depositAmount = 100e18;
        vm.startPrank(alice);
        asset.approve(address(vaultContract), depositAmount); // Approve the vault contract address
        vaultContract.deposit(depositAmount, alice);
        vm.stopPrank();

        // Simulate cross-chain yield sync
        uint256 crossChainYield = 10e18;

        // First, configure the chain to be active
        vm.prank(address(vaultContract)); // AetherStrategy.configureChain expects vault as caller
        strategyContract.configureChain(1, address(0x123), true); // Chain ID 1, dummy remote strategy

        // Then sync the cross-chain yield
        vm.prank(address(vaultContract)); // AetherStrategy.syncCrossChainYield expects vault as caller
        strategyContract.syncCrossChainYield(1, crossChainYield); // Chain ID 1

        // Verify total assets includes cross-chain yield
        assertEq(vaultContract.totalAssets(), depositAmount + crossChainYield, "Cross-chain yield not added");
    }

    function test_MultiUserScenario() public {
        // Deploy vault
        (address vaultAddress, address trueStrategyAddress) = factory.deployVault(address(asset), "TEST Vault", "vTEST");
        AetherVault vaultContract = AetherVault(vaultAddress);
        // AetherStrategy strategyContract = AetherStrategy(trueStrategyAddress); // Not used for direct calls in this test

        // Alice deposits
        uint256 aliceDeposit = 100e18;
        vm.startPrank(alice);
        asset.approve(address(vaultContract), aliceDeposit); // Approve the vault contract address
        vaultContract.deposit(aliceDeposit, alice);
        vm.stopPrank();

        // Generate some yield
        vm.warp(block.timestamp + 1 days);

        // Bob deposits
        uint256 bobDeposit = 50e18;
        vm.startPrank(bob);
        asset.approve(address(vaultContract), bobDeposit); // Fix: use vaultContract or vaultAddress
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
