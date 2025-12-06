// SPDX-License-Identifier: GPL-3.0

/*
Created by irfndi (github.com/irfndi) - Apr 2025
Email: join.mantap@gmail.com
*/

pragma solidity ^0.8.29;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol"; // Import ReentrancyGuard
import {AetherVault} from "./AetherVault.sol";
import {HookFlags} from "../interfaces/HookFlags.sol";
import {AetherStrategy} from "./AetherStrategy.sol";
import {IPoolManager} from "../interfaces/IPoolManager.sol";
import {ILayerZeroEndpoint} from "../interfaces/ILayerZeroEndpoint.sol";

/**
 * @title AetherVaultFactory
 * @dev Factory contract for deploying AetherVault and AetherStrategy pairs
 * Manages deployment, initialization, and tracking of vaults across chains
 */
contract AetherVaultFactory is
    Ownable,
    ReentrancyGuard // Inherit ReentrancyGuard
{
    IPoolManager public immutable poolManager;
    ILayerZeroEndpoint public immutable lzEndpoint;

    // Default rebalance interval (24 hours)
    uint256 public constant DEFAULT_REBALANCE_INTERVAL = 24 hours;

    struct VaultInfo {
        address vault;
        address strategy;
        address asset;
        bool isActive;
        uint256 tvl;
        uint256 deployedAt;
    }

    // Mapping from asset address to vault info
    mapping(address => VaultInfo) public vaults;
    // Array to track all deployed vault addresses
    address[] public allVaults;

    event VaultDeployed(
        address indexed vault, address indexed strategy, address indexed asset, string name, string symbol
    );
    event VaultActivated(address indexed vault);
    event VaultDeactivated(address indexed vault);

    constructor(address _poolManager, address _lzEndpoint) Ownable(msg.sender) {
        poolManager = IPoolManager(_poolManager);
        lzEndpoint = ILayerZeroEndpoint(_lzEndpoint);
    }

    /**
     * @dev Deploy a new vault and strategy pair for an asset
     * @param asset The underlying asset token
     * @param name Vault token name
     * @param symbol Vault token symbol
     * @return vaultAddress The deployed vault address
     * @return trueStrategyAddress The true (unflagged) deployed strategy address
     */
    function deployVault(address asset, string memory name, string memory symbol)
        external
        onlyOwner
        nonReentrant // Added nonReentrant modifier
        returns (address vaultAddress, address trueStrategyAddress)
     // Renamed return variables
    {
        // --- Checks ---
        require(asset != address(0), "Invalid asset address");
        require(vaults[asset].vault == address(0), "Vault already exists");

        // --- Interactions (Deploy contracts first) ---
        // Deploy vault
        vaultAddress = address(new AetherVault(IERC20(asset), name, symbol, poolManager));

        // Deploy strategy and get its true address
        trueStrategyAddress = address(
            new AetherStrategy{salt: keccak256(abi.encode(name, symbol))}(
                vaultAddress, address(lzEndpoint), address(poolManager), DEFAULT_REBALANCE_INTERVAL
            )
        );

        // Create the flagged strategy address for hook registration / storage
        address flaggedStrategyAddress = address(
            uint160(trueStrategyAddress) | uint160(HookFlags.Flags.AFTER_MODIFY_POSITION)
                | uint160(HookFlags.Flags.AFTER_SWAP)
        );

        // --- Effects (Update state *before* external setStrategy call) ---
        // Store vault info
        vaults[asset] = VaultInfo({
            vault: vaultAddress,
            strategy: flaggedStrategyAddress, // Store the flagged address
            asset: asset,
            isActive: true,
            tvl: 0,
            deployedAt: block.timestamp
        });
        allVaults.push(vaultAddress);
        // Emit event with the flagged strategy address, assuming it's the identifier used elsewhere
        emit VaultDeployed(vaultAddress, flaggedStrategyAddress, asset, name, symbol); // Event logs the flagged address as 'strategy'

        // --- Interaction (Initialize vault with strategy) ---
        // Vault's internal 'strategy' state variable should be the true, callable address
        AetherVault(vaultAddress).setStrategy(trueStrategyAddress);

        // Returns (vaultAddress, trueStrategyAddress) due to named returns
    }

    /**
     * @dev Activate a vault
     * @param asset The underlying asset token
     */
    function activateVault(address asset) external onlyOwner {
        // Slither: Timestamp - This check verifies vault existence. See comment in deployVault.
        require(vaults[asset].vault != address(0), "Vault does not exist");
        // Slither: Timestamp - This checks the boolean `isActive` flag. See comment in deployVault.
        require(!vaults[asset].isActive, "Vault already active");

        vaults[asset].isActive = true;
        emit VaultActivated(vaults[asset].vault);
    }

    /**
     * @dev Deactivate a vault
     * @param asset The underlying asset token
     */
    function deactivateVault(address asset) external onlyOwner {
        // Slither: Timestamp - This check verifies vault existence. See comment in deployVault.
        require(vaults[asset].vault != address(0), "Vault does not exist");
        // Slither: Timestamp - This checks the boolean `isActive` flag. See comment in deployVault.
        require(vaults[asset].isActive, "Vault already inactive");

        vaults[asset].isActive = false;
        emit VaultDeactivated(vaults[asset].vault);
    }

    /**
     * @dev Update TVL for a vault
     * @param asset The underlying asset token
     * @param newTVL The new TVL value
     */
    function updateVaultTVL(address asset, uint256 newTVL) external {
        // Slither: Timestamp - This check verifies the caller (`msg.sender`) against the stored vault address.
        // See comment in deployVault regarding timestamp presence in the struct vs. usage in logic.
        require(msg.sender == vaults[asset].vault, "Only vault can update TVL");
        vaults[asset].tvl = newTVL;
    }

    /**
     * @dev Get all vault addresses
     * @return Array of vault addresses
     */
    function getAllVaults() external view returns (address[] memory) {
        return allVaults;
    }

    /**
     * @dev Get vault info for an asset
     * @param asset The underlying asset token
     * @return VaultInfo struct
     */
    function getVaultInfo(address asset) external view returns (VaultInfo memory) {
        return vaults[asset];
    }

    /**
     * @dev Check if a vault exists for an asset
     * @param asset The underlying asset token
     * @return bool indicating if vault exists
     */
    function hasVault(address asset) external view returns (bool) {
        // Slither: Timestamp - This check verifies vault existence by checking the vault address.
        // See comment in deployVault regarding timestamp presence in the struct vs. usage in logic.
        return vaults[asset].vault != address(0);
    }

    /**
     * @dev Get total number of vaults
     * @return uint256 number of vaults
     */
    function getVaultCount() external view returns (uint256) {
        return allVaults.length;
    }

    /**
     * @dev Get vault by index
     * @param index The index in allVaults array
     * @return vault address and strategy address
     */
    function getVaultByIndex(uint256 index) external view returns (address vault, address strategy) {
        require(index < allVaults.length, "Invalid index");
        vault = allVaults[index];
        strategy = vaults[AetherVault(vault).asset()].strategy;
    }
}
