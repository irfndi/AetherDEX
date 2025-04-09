// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.29;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol"; // Import ReentrancyGuard
import {ILayerZeroEndpoint} from "../interfaces/ILayerZeroEndpoint.sol";
import {AetherVault} from "./AetherVault.sol";
import {PoolKey} from "../types/PoolKey.sol";
import {IPoolManager} from "../interfaces/IPoolManager.sol";

/**
 * @title AetherStrategy
 * @dev Strategy contract for AetherVault that manages yield generation
 * and cross-chain interactions
 */
contract AetherStrategy is ReentrancyGuard { // Inherit ReentrancyGuard
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

    /**
     * @notice Sync cross-chain yield from a remote chain
     * @param chainId The ID of the remote chain
     * @param amount The amount of yield to sync
     */
    function syncCrossChainYield(uint16 chainId, uint256 amount) external onlyVault {
        require(chainConfigs[chainId].isActive, "Chain not configured");
        // Update the vault with the cross-chain yield
        vault.syncCrossChainYield(chainId, amount);
        emit CrossChainYieldSynced(chainId, amount);
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
        if (!chainConfigs[chainId].isActive && isActive) {
            supportedChains.push(chainId);
        }

        chainConfigs[chainId] = ChainConfig({chainId: chainId, remoteStrategy: remoteStrategy, isActive: isActive});

        emit ChainConfigUpdated(chainId, remoteStrategy, isActive);
    }

    /**
     * @dev Update the base yield rate
     * @param newRate New yield rate (per second, scaled by YIELD_RATE_PRECISION)
     */
    function updateBaseYieldRate(uint256 newRate) external onlyVault {
        uint256 oldRate = baseYieldRate;
        baseYieldRate = newRate;
        vault.updateYieldRate(newRate);
        emit YieldRateUpdated(oldRate, newRate);
    }

    /**
     * @dev Rebalance yield across chains
     * Can only be called after rebalanceInterval has passed
     */
    function rebalanceYield() external nonReentrant { // Added nonReentrant modifier
        require(block.timestamp >= lastRebalance + rebalanceInterval, "Rebalance interval not met"); // Check

        // --- Effects ---
        // Update lastRebalance timestamp *before* external calls
        uint256 currentTimestamp = block.timestamp;
        lastRebalance = currentTimestamp;
        emit StrategyRebalanced(currentTimestamp, 0); // Emit event early (totalYield calculation removed for simplicity, needs review)

        // --- Interactions ---
        uint256 totalYield = 0; // [TODO] Recalculate or fetch actual yield
        uint256 activeChains = 0;

        // Calculate total yield across all active chains
        for (uint256 i = 0; i < supportedChains.length; i++) {
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

            for (uint256 i = 0; i < supportedChains.length; i++) {
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
    function lzReceive(uint16 _srcChainId, bytes memory _srcAddress, uint64, /* _nonce */ bytes memory _payload)
        external
        nonReentrant // Added nonReentrant modifier
    {
        require(msg.sender == address(lzEndpoint), "Invalid endpoint"); // Check
        require(chainConfigs[_srcChainId].isActive, "Chain not active"); // Check

        // Verify the sender is the registered remote strategy
        address srcAddress;
        assembly {
            srcAddress := mload(add(_srcAddress, 20))
        }
        require(srcAddress == chainConfigs[_srcChainId].remoteStrategy, "Invalid remote strategy"); // Check

        // Decode yield update
        uint256 yieldAmount = abi.decode(_payload, (uint256)); // Effect (local processing)

        // Emit event *before* external call
        emit CrossChainYieldSynced(_srcChainId, yieldAmount); // Effect (Event)

        // External interaction
        vault.syncCrossChainYield(_srcChainId, yieldAmount); // Interaction
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
    function estimateFees(uint16 _chainId, uint256 _yieldAmount)
        external
        view
        returns (uint256 nativeFee, uint256 zroFee)
    {
        bytes memory payload = abi.encode(_yieldAmount);
        bytes memory remoteAndLocalAddresses = abi.encodePacked(chainConfigs[_chainId].remoteStrategy, address(this));

        return lzEndpoint.estimateFees(_chainId, address(this), payload, false, remoteAndLocalAddresses);
    }

    /**
     * @dev Update the rebalance interval
     */
    function setRebalanceInterval(uint256 _interval) external onlyVault {
        rebalanceInterval = _interval;
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
    function getChainConfig(uint16 _chainId) external view returns (ChainConfig memory) {
        return chainConfigs[_chainId];
    }
}
