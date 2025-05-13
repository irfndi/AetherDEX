// SPDX-License-Identifier: GPL-3.0

/*
Created by irfndi (github.com/irfndi) - Apr 2025
Email: join.mantap@gmail.com
*/

pragma solidity ^0.8.29;

import {Create2} from "@openzeppelin/contracts/utils/Create2.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Hooks} from "@uniswap/v4-core/libraries/Hooks.sol";
import {AetherVault} from "./AetherVault.sol";
import {AetherStrategy} from "./AetherStrategy.sol";
import {IPoolManager} from "../interfaces/IPoolManager.sol";
import {ILayerZeroEndpoint} from "../interfaces/ILayerZeroEndpoint.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title AetherVaultFactory
 * @dev Factory for deploying AetherVault and AetherStrategy pairs.
 */
contract AetherVaultFactory is Ownable, ReentrancyGuard {
    using Create2 for bytes;
    using SafeERC20 for IERC20;

    IPoolManager public immutable poolManager;
    ILayerZeroEndpoint public immutable lzEndpoint;

    // Default rebalance interval (24 hours)
    uint256 public constant DEFAULT_REBALANCE_INTERVAL = 1 days;

    // Define the struct to hold vault information
    struct VaultInfo {
        address vault;
        address strategy;
        bool isActive;
    }

    // Mapping from asset address to vault info
    mapping(address => VaultInfo) public vaults;
    // Array to track all deployed vault addresses
    address[] public allVaults;

    // Define the event to be emitted upon vault creation
    event VaultDeployed(
        address indexed vault,
        address indexed cleanStrategyAddress,
        address strategyWithHooks,
        address indexed asset,
        string name,
        string symbol
    );

    event VaultStatusUpdated(address indexed asset, bool isActive);

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
     * @return cleanStrategy The deployed strategy address
     * @return strategyWithHooks The deployed strategy address with hooks
     */
    function deployVault(address asset, string memory name, string memory symbol)
        external
        onlyOwner
        nonReentrant
        returns (address vaultAddress, address cleanStrategy, address strategyWithHooks)
    {
        // --- Checks ---
        require(asset != address(0), "Invalid asset address");
        // Slither: Timestamp - This check verifies if a vault already exists for the asset by checking
        // the vault address in the mapping. It does not directly use block.timestamp in its logic,
        // although the VaultInfo struct contains a `deployedAt` timestamp. This is a standard existence check.
        require(vaults[asset].vault == address(0), "Vault already exists");

        // --- Interactions (Deploy contracts first) ---
        // Deploy strategy
        address cleanStrategyAddress = address(
            new AetherStrategy{salt: keccak256(abi.encode(name, symbol))}(
                address(lzEndpoint),
                address(poolManager),
                DEFAULT_REBALANCE_INTERVAL
            )
        );
        require(cleanStrategyAddress != address(0), "Strategy deployment failed");

        strategyWithHooks = address(
            uint160(cleanStrategyAddress) | 
            uint160(Hooks.AFTER_ADD_LIQUIDITY_FLAG) | 
            uint160(Hooks.AFTER_REMOVE_LIQUIDITY_FLAG) | 
            uint160(Hooks.AFTER_SWAP_FLAG)
        );

        // Deploy AetherVault
        bytes memory vaultBytecode = type(AetherVault).creationCode;

        // Pass the CLEAN strategy address to the vault constructor
        bytes memory constructorArgs = abi.encode(asset, name, symbol, address(this), address(asset), cleanStrategyAddress);

        // Combine bytecode with constructor arguments
        bytes memory fullVaultBytecode = abi.encodePacked(vaultBytecode, constructorArgs);
        bytes32 vaultSalt = keccak256(abi.encodePacked(asset, name, symbol));

        vaultAddress = Create2.deploy(0, vaultSalt, fullVaultBytecode);
        require(vaultAddress != address(0), "Vault deployment failed");

        // Set the vault address in the strategy using the clean address
        AetherStrategy(cleanStrategyAddress).setVaultAddress(vaultAddress);

        // --- Effects (Update state *before* external setStrategy call) ---
        // Store vault info (using the flagged strategy address for VaultInfo and AetherVault constructor)
        vaults[asset] = VaultInfo({
            vault: vaultAddress,
            strategy: strategyWithHooks, // Store flagged strategy address
            isActive: false
        });
        allVaults.push(vaultAddress);
        emit VaultDeployed(vaultAddress, cleanStrategyAddress, strategyWithHooks, asset, name, symbol); // Emit updated event

        return (vaultAddress, cleanStrategyAddress, strategyWithHooks); // Return all three addresses
    }

    /**
     * @dev Activate a vault for an asset
     */
    function activateVault(address asset) external onlyOwner {
        require(vaults[asset].vault != address(0), "Vault not deployed");
        require(!vaults[asset].isActive, "Vault already active");
        vaults[asset].isActive = true;
        emit VaultStatusUpdated(asset, true);
    }

    /**
     * @dev Deactivate a vault for an asset
     */
    function deactivateVault(address asset) external onlyOwner {
        require(vaults[asset].vault != address(0), "Vault not deployed");
        require(vaults[asset].isActive, "Vault not active");
        vaults[asset].isActive = false;
        emit VaultStatusUpdated(asset, false);
    }

    /**
     * @dev Update the total value locked (TVL) for a vault (placeholder)
     */
    function updateVaultTVL(address /* asset */, uint256 /* newTVL */) external view {
        // Placeholder for potential future use, currently does nothing
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
        VaultInfo storage info = vaults[asset];
        require(info.vault != address(0), "Vault does not exist");
        return info;
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

    /**
     * @dev Get all vaults length
     * @return uint256 length of all vaults
     */
    function allVaultsLength() external view returns (uint256) {
        return allVaults.length;
    }

    /**
     * @dev Allow owner to withdraw any accidentally sent ERC20 tokens
     * @param tokenAddress The token address to withdraw
     */
    function withdrawTokens(address tokenAddress) external onlyOwner {
        uint256 balance = IERC20(tokenAddress).balanceOf(address(this));
        if (balance > 0) {
            SafeERC20.safeTransfer(IERC20(tokenAddress), owner(), balance);
        }
    }

    /**
     * @dev Function to allow owner to withdraw native currency (ETH) sent to the factory
     */
    function withdrawNativeCurrency() external onlyOwner {
        uint256 balance = address(this).balance;
        if (balance > 0) {
            (bool success, ) = payable(owner()).call{value: balance}("");
            require(success, "Failed to withdraw native currency");
        }
    }
}
