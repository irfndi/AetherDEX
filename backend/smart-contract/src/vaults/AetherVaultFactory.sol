// SPDX-License-Identifier: GPL-3.0
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
contract AetherVaultFactory is Ownable, ReentrancyGuard { // Inherit ReentrancyGuard
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
     * @return vault The deployed vault address
     * @return strategy The deployed strategy address
     */
    function deployVault(address asset, string memory name, string memory symbol)
        external
        onlyOwner
        nonReentrant // Added nonReentrant modifier
        returns (address vault, address strategy)
    {
        // --- Checks ---
        require(asset != address(0), "Invalid asset address");
        require(vaults[asset].vault == address(0), "Vault already exists");

        // --- Interactions (Deploy contracts first) ---
        // Deploy vault
        vault = address(new AetherVault(IERC20(asset), name, symbol, poolManager));

        // Deploy strategy
        strategy = address(
            uint160(
                address(
                    new AetherStrategy{salt: keccak256(abi.encode(name, symbol))}(
                        vault, address(lzEndpoint), address(poolManager), DEFAULT_REBALANCE_INTERVAL
                    )
                )
            ) | uint160(HookFlags.Flags.AFTER_MODIFY_POSITION) | uint160(HookFlags.Flags.AFTER_SWAP)
        );

        // --- Effects (Update state *before* external setStrategy call) ---
        // Store vault info
        vaults[asset] = VaultInfo({
            vault: vault,
            strategy: strategy,
            asset: asset,
            isActive: true,
            tvl: 0,
            deployedAt: block.timestamp
        });
        allVaults.push(vault);
        emit VaultDeployed(vault, strategy, asset, name, symbol); // Emit event before external call

        // --- Interaction (Initialize vault with strategy) ---
        AetherVault(vault).setStrategy(strategy);

        // return vault, strategy; // Implicitly returned
    }

    /**
     * @dev Activate a vault
     * @param asset The underlying asset token
     */
    function activateVault(address asset) external onlyOwner {
        require(vaults[asset].vault != address(0), "Vault does not exist");
        require(!vaults[asset].isActive, "Vault already active");

        vaults[asset].isActive = true;
        emit VaultActivated(vaults[asset].vault);
    }

    /**
     * @dev Deactivate a vault
     * @param asset The underlying asset token
     */
    function deactivateVault(address asset) external onlyOwner {
        require(vaults[asset].vault != address(0), "Vault does not exist");
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
