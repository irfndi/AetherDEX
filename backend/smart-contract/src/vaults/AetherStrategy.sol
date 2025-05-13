// SPDX-License-Identifier: GPL-3.0

/*
Created by irfndi (github.com/irfndi) - Apr 2025
Email: join.mantap@gmail.com
*/

pragma solidity ^0.8.29;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol"; 
import {ILayerZeroEndpointV2, MessagingFee, MessagingParams, MessagingReceipt} from "@layerzerolabs/lz-evm-protocol-v2/contracts/interfaces/ILayerZeroEndpointV2.sol";
import {IAetherVault} from "src/interfaces/IAetherVault.sol"; 
import {IPoolManager} from "../interfaces/IPoolManager.sol";
import {SendParam} from "@layerzerolabs/lz-evm-oapp-v2/contracts/oft/OFTCore.sol";
import "forge-std/console.sol"; // Added for logging

/**
 * @title AetherStrategy
 * @dev Strategy contract for AetherVault that manages yield generation
 * and cross-chain interactions
 */
contract AetherStrategy is
    ReentrancyGuard 
{
    using SafeERC20 for IERC20;

    struct ChainConfig {
        uint16 chainId;
        address remoteStrategy;
        bool isActive;
    }

    address public owner; 
    IAetherVault public vault; 
    ILayerZeroEndpointV2 public immutable lzEndpointInstance;
    IPoolManager public immutable poolManager;

    mapping(uint16 => ChainConfig) public chainConfigs;
    uint16[] public supportedChains;

    uint256 public constant YIELD_RATE_PRECISION = 1e18;
    uint256 internal baseYieldRate;
    uint256 internal lastRebalance;
    uint256 public rebalanceInterval;

    event ChainConfigUpdated(uint16 chainId, address remoteStrategy, bool isActive);
    event YieldRateUpdated(uint256 oldRate, uint256 newRate);
    event CrossChainYieldSynced(uint16 chainId, uint256 amount);
    event RebalanceIntervalUpdated(uint256 oldInterval, uint256 newInterval); 

    /**
     * @notice Sync cross-chain yield from a remote chain
     * @param chainId The ID of the remote chain
     * @param amount The amount of yield to sync
     */
    function syncCrossChainYield(uint16 chainId, uint256 amount) external onlyVault {
        require(chainConfigs[chainId].isActive, "Chain not configured"); 
        emit CrossChainYieldSynced(chainId, amount); 
        vault.syncCrossChainYield(chainId, amount); 
    }

    event StrategyRebalanced(uint256 timestamp, uint256 totalYield);

    modifier onlyVault() {
        require(msg.sender == address(vault), "Only vault can call");
        _;
    }

    modifier onlyOwner() { 
        require(msg.sender == owner, "AetherStrategy: CALLER_NOT_OWNER");
        _;
    }

    constructor(address _lzEndpoint, address _poolManager, uint256 _rebalanceInterval) { 
        owner = msg.sender; 
        lzEndpointInstance = ILayerZeroEndpointV2(_lzEndpoint);
        poolManager = IPoolManager(_poolManager);
        rebalanceInterval = _rebalanceInterval;
        lastRebalance = block.timestamp;
        // vault assignment removed, will be set by setVaultAddress
    }

    /**
     * @dev Sets the vault address. Can only be called once by the owner.
     * @param _vaultAddr The address of the AetherVault contract.
     */
    function setVaultAddress(address _vaultAddr) external onlyOwner {
        require(address(vault) == address(0), "AetherStrategy: VAULT_ALREADY_SET");
        require(_vaultAddr != address(0), "AetherStrategy: INVALID_VAULT_ADDRESS");
        vault = IAetherVault(_vaultAddr);
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
    function updateBaseYieldRate(uint256 newRate) external onlyVault nonReentrant {
        uint256 oldRate = baseYieldRate; 
        baseYieldRate = newRate; 
        emit YieldRateUpdated(oldRate, newRate); 
        vault.updateYieldRate(newRate); 
    }

    /**
     * @dev Rebalance yield across chains
     * Can only be called after rebalanceInterval has passed
     */
    function rebalanceYield() external nonReentrant {
        require(block.timestamp >= lastRebalance + rebalanceInterval, "Rebalance interval not met"); 

        uint256 currentTimestamp = block.timestamp;
        lastRebalance = currentTimestamp;
        emit StrategyRebalanced(currentTimestamp, 0); 

        uint256 totalYield = 0; 
        uint256 activeChains = 0;
        uint256 numSupportedChains = supportedChains.length; 

        for (uint256 i = 0; i < numSupportedChains; i++) {
            uint16 chainId = supportedChains[i];
            if (chainConfigs[chainId].isActive) {
                activeChains++;
            }
        }

        if (activeChains > 0) {
            uint256 yieldPerChain = totalYield / activeChains;

            for (uint256 i = 0; i < numSupportedChains; i++) {
                uint16 chainId = supportedChains[i];
                if (chainConfigs[chainId].isActive) {
                    _sendYieldUpdate(chainId, yieldPerChain);
                }
            }
        }
    }

    /**
     * @dev Handle incoming yield updates from other chains
     */
    function lzReceive(
        uint16 srcChainId, 
        bytes memory srcAddress, 
        uint64, 
        bytes calldata payload 
    ) external nonReentrant {
        console.log("AetherStrategy.lzReceive called");
        console.log("srcChainId:", srcChainId);
        console.logBytes(srcAddress);
        console.logBytes(payload);
        console.log("msg.sender (expected lzEndpointInstance):", msg.sender);
        console.log("lzEndpointInstance:", address(lzEndpointInstance));

        require(msg.sender == address(lzEndpointInstance), "Invalid endpoint");
        
        require(chainConfigs[srcChainId].isActive, "Chain not active");

        // Decode source address using standard abi.decode
        address sourceAddressDecoded = abi.decode(srcAddress, (address)); 

        // Check if the sender address matches the configured remote strategy for the source chain
        require(sourceAddressDecoded == chainConfigs[srcChainId].remoteStrategy, "Invalid remote strategy");

        // Decode yield amount from payload
        uint256 yieldAmount = abi.decode(payload, (uint256)); 
        vault.syncCrossChainYield(srcChainId, yieldAmount); 

        emit CrossChainYieldSynced(srcChainId, yieldAmount); 
    }

    /**
     * @dev Send yield updates to other chains
     */
    function _sendYieldUpdate(uint16 _chainId, uint256 _yieldAmount) internal {
        require(chainConfigs[_chainId].isActive, "Chain not active");

        bytes memory payload = abi.encode(_yieldAmount);

        MessagingParams memory messagingParams = MessagingParams({
            dstEid: _chainId,
            receiver: bytes32(uint256(uint160(chainConfigs[_chainId].remoteStrategy))),
            message: payload,
            options: bytes(""),
            payInLzToken: false
        });

        MessagingFee memory fee = lzEndpointInstance.quote(messagingParams, address(this));

        lzEndpointInstance.send{value: fee.nativeFee}(
            messagingParams,
            msg.sender
        );
    }

    /**
     * @dev Estimate LayerZero fees for cross-chain messaging
     */
    function estimateFees(
        uint16 chainId, 
        uint256 yieldAmount, 
        bool payInLzToken 
    ) external view returns (uint256 nativeFee, uint256 lzTokenFee) { 
        require(chainConfigs[chainId].isActive, "Chain not configured"); 
        bytes memory payload = abi.encode(yieldAmount);
        bytes32 receiverBytes = bytes32(uint256(uint160(chainConfigs[chainId].remoteStrategy)));
        // Define options (likely empty for estimation, confirm if specific options affect fees)
        bytes memory options = bytes("");

        // Construct MessagingParams for quote
        MessagingParams memory messagingParams = MessagingParams({
            dstEid: chainId,
            receiver: receiverBytes,
            message: payload,
            options: options,
            payInLzToken: payInLzToken
        });

        // Call quote instead of estimateFees
        MessagingFee memory fee = lzEndpointInstance.quote(messagingParams, address(this));

        return (fee.nativeFee, fee.lzTokenFee);
    }

    /**
     * @dev Update the rebalance interval
     */
    function setRebalanceInterval(uint256 interval) external onlyVault {
        uint256 oldInterval = rebalanceInterval; 
        rebalanceInterval = interval; 
        emit RebalanceIntervalUpdated(oldInterval, interval); 
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
