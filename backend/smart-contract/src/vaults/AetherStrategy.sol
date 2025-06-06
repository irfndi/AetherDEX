// SPDX-License-Identifier: GPL-3.0

/*
Created by irfndi (github.com/irfndi) - Apr 2025
Email: join.mantap@gmail.com
*/

pragma solidity ^0.8.29;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol"; // Import ReentrancyGuard
import {ILayerZeroEndpoint} from "../interfaces/ILayerZeroEndpoint.sol";
import {AetherVault} from "./AetherVault.sol";
import {PoolKey} from "../types/PoolKey.sol";
import {IPoolManager} from "../interfaces/IPoolManager.sol";
import "forge-std/console.sol";

/**
 * @title AetherStrategy
 * @dev Strategy contract for AetherVault that manages yield generation
 * and cross-chain interactions
 */
contract AetherStrategy is
    ReentrancyGuard // Inherit ReentrancyGuard
{
    using SafeERC20 for IERC20;

    struct ChainConfig {
        uint16 chainId;
        address remoteStrategy;
        bool isActive;
    }

    AetherVault public immutable vault;
    ILayerZeroEndpoint public immutable lzEndpoint;
    IPoolManager public immutable poolManager;

    mapping(uint16 => ChainConfig) public chainConfigs;
    uint16[] public supportedChains;

    uint256 public constant YIELD_RATE_PRECISION = 1e18;
    uint256 public baseYieldRate;
    uint256 public lastRebalance;
    uint256 public rebalanceInterval;

    event ChainConfigUpdated(uint16 chainId, address remoteStrategy, bool isActive);
    event YieldRateUpdated(uint256 oldRate, uint256 newRate);
    event CrossChainYieldSynced(uint16 chainId, uint256 amount);
    event RebalanceIntervalUpdated(uint256 oldInterval, uint256 newInterval); // Added event

    /**
     * @notice Sync cross-chain yield from a remote chain
     * @param chainId The ID of the remote chain
     * @param amount The amount of yield to sync
     */
    function syncCrossChainYield(uint16 chainId, uint256 amount) external onlyVault {
        console.log("AetherStrategy: Entered syncCrossChainYield. chainId:", chainId, " amount:", amount);
        require(chainConfigs[chainId].isActive, "Chain not configured"); // Check
        // Emit event *before* external call
        emit CrossChainYieldSynced(chainId, amount); // Effect (Event)
        // Update the vault with the cross-chain yield
        console.log("AetherStrategy: Calling vault.syncCrossChainYield");
        vault.syncCrossChainYield(chainId, amount); // Interaction
        console.log("AetherStrategy: Returned from vault.syncCrossChainYield");
    }

    event StrategyRebalanced(uint256 timestamp, uint256 totalYield);

    modifier onlyVault() {
        require(msg.sender == address(vault), "Only vault can call");
        _;
    }

    constructor(address _vault, address _lzEndpoint, address _poolManager, uint256 _rebalanceInterval) {
        vault = AetherVault(_vault);
        lzEndpoint = ILayerZeroEndpoint(_lzEndpoint);
        poolManager = IPoolManager(_poolManager);
        rebalanceInterval = _rebalanceInterval;
        lastRebalance = block.timestamp;
    }

    /**
     * @dev Configure a supported chain
     * @param chainId LayerZero chain ID
     * @param remoteStrategy Strategy address on remote chain
     * @param isActive Whether the chain is active
     */
    function configureChain(uint16 chainId, address remoteStrategy, bool isActive) external onlyVault {
        console.log("AetherStrategy: Entered configureChain.");
        console.log("chainId:", chainId);
        console.log("remoteStrategy:", remoteStrategy);
        console.log("isActive:", isActive);
        if (!chainConfigs[chainId].isActive && isActive) {
            supportedChains.push(chainId);
        }

        chainConfigs[chainId] = ChainConfig({chainId: chainId, remoteStrategy: remoteStrategy, isActive: isActive});

        emit ChainConfigUpdated(chainId, remoteStrategy, isActive);
        console.log("AetherStrategy: Exiting configureChain");
    }

    /**
     * @dev Update the base yield rate
     * @param newRate New yield rate (per second, scaled by YIELD_RATE_PRECISION)
     */
    function updateBaseYieldRate(uint256 newRate) external onlyVault nonReentrant {
        console.log("AetherStrategy: Entered updateBaseYieldRate");
        // Added nonReentrant modifier
        uint256 oldRate = baseYieldRate; // Effect (Read state)
        baseYieldRate = newRate; // Effect (Write state)
        // Emit event *before* external call
        emit YieldRateUpdated(oldRate, newRate); // Effect (Event)
        console.log("AetherStrategy: Calling vault.updateYieldRate");
        vault.updateYieldRate(newRate); // Interaction
        console.log("AetherStrategy: Returned from vault.updateYieldRate");
    }

    /**
     * @dev Rebalance yield across chains
     * Can only be called after rebalanceInterval has passed
     */
    function rebalanceYield() external nonReentrant {
        // Added nonReentrant modifier
        // Slither: Timestamp - Using block.timestamp is necessary to enforce the rebalanceInterval.
        // This is a standard pattern for time-based logic in smart contracts.
        require(block.timestamp >= lastRebalance + rebalanceInterval, "Rebalance interval not met"); // Check

        // --- Effects ---
        // Update lastRebalance timestamp *before* external calls
        uint256 currentTimestamp = block.timestamp;
        lastRebalance = currentTimestamp;
        emit StrategyRebalanced(currentTimestamp, 0); // Emit event early (totalYield calculation removed for simplicity, needs review)

        // --- Interactions ---
        uint256 totalYield = 0; // TODO Recalculate or fetch actual yield
        uint256 activeChains = 0;
        uint256 numSupportedChains = supportedChains.length; // Cache array length

        // Calculate total yield across all active chains
        for (uint256 i = 0; i < numSupportedChains; i++) {
            // Use cached length
            uint16 chainId = supportedChains[i];
            if (chainConfigs[chainId].isActive) {
                // In a real implementation, we would fetch actual yield data
                // from each chain. This is simplified for demonstration.
                activeChains++;
            }
        }

        if (activeChains > 0) {
            // Distribute yield evenly across active chains
            uint256 yieldPerChain = totalYield / activeChains;

            // Slither: Calls-inside-a-loop - The external call to _sendYieldUpdate (which calls lzEndpoint.send)
            // is necessary within the loop to distribute yield updates to each configured and active chain.
            // Gas usage should be monitored, especially with a large number of supported chains.
            for (uint256 i = 0; i < numSupportedChains; i++) {
                // Use cached length
                uint16 chainId = supportedChains[i];
                if (chainConfigs[chainId].isActive) {
                    _sendYieldUpdate(chainId, yieldPerChain);
                }
            }
        }

        // lastRebalance = block.timestamp; // Moved earlier
        // emit StrategyRebalanced(block.timestamp, totalYield); // Moved earlier
    }

    /**
     * @dev Handle incoming yield updates from other chains
     */
    function lzReceive(
        uint16 srcChainId, // Renamed from _srcChainId
        bytes memory srcAddress, // Changed back to memory
        uint64, // nonce
        bytes calldata payload // Renamed from _payload
    ) external nonReentrant {
        // Added nonReentrant modifier
        require(msg.sender == address(lzEndpoint), "Invalid endpoint"); // Check
        require(chainConfigs[srcChainId].isActive, "Chain not active"); // Check

        // Verify the sender is the registered remote strategy
        // Slither: Assembly - Inline assembly is used here to efficiently extract the source address
        // from the `bytes memory srcAddress` provided by LayerZero's lzReceive function.
        // This is a standard and gas-efficient pattern for handling LayerZero messages.
        address sourceAddressDecoded;
        assembly {
            sourceAddressDecoded := mload(add(srcAddress, 20)) // Use renamed param (now memory)
        }
        require(sourceAddressDecoded == chainConfigs[srcChainId].remoteStrategy, "Invalid remote strategy"); // Check

        // Decode yield update
        uint256 yieldAmount = abi.decode(payload, (uint256)); // Use renamed param
        vault.syncCrossChainYield(srcChainId, yieldAmount); // Use renamed param

        emit CrossChainYieldSynced(srcChainId, yieldAmount); // Use renamed param
    }

    /**
     * @dev Send yield updates to other chains
     */
    function _sendYieldUpdate(uint16 _chainId, uint256 _yieldAmount) internal {
        require(chainConfigs[_chainId].isActive, "Chain not active");

        bytes memory payload = abi.encode(_yieldAmount);
        bytes memory remoteAndLocalAddresses = abi.encodePacked(chainConfigs[_chainId].remoteStrategy, address(this));

        // Send cross-chain message via LayerZero
        lzEndpoint.send{value: 0}(
            _chainId, remoteAndLocalAddresses, payload, payable(msg.sender), address(0), bytes("")
        );
    }

    /**
     * @dev Estimate LayerZero fees for cross-chain messaging
     */
    function estimateFees(
        uint16 chainId, // Renamed from _chainId
        uint256 yieldAmount, // Renamed from _yieldAmount
        bool useZro
    ) external view returns (uint256 nativeFee, uint256 zroFee) {
        require(chainConfigs[chainId].isActive, "Chain not configured"); // Use renamed param
        bytes memory payload = abi.encode(yieldAmount); // Use renamed param
        bytes memory remoteAndLocalAddresses = abi.encodePacked(chainConfigs[chainId].remoteStrategy, address(this));

        // Capture and return the estimated fees using named return variables
        (nativeFee, zroFee) = lzEndpoint.estimateFees(chainId, address(this), payload, useZro, remoteAndLocalAddresses); // Use renamed param
            // No explicit return needed here
    }

    /**
     * @dev Update the rebalance interval
     */
    function setRebalanceInterval(uint256 interval) external onlyVault {
        uint256 oldInterval = rebalanceInterval; // Read old value
        rebalanceInterval = interval; // Update state
        emit RebalanceIntervalUpdated(oldInterval, interval); // Emit event
    }

    /**
     * @dev Get all supported chains
     */
    function getSupportedChains() external view returns (uint16[] memory) {
        return supportedChains;
    }

    /**
     * @dev Get chain configuration
     */
    function getChainConfig(uint16 chainId_) external view returns (ChainConfig memory) {
        return chainConfigs[chainId_];
    }
}
