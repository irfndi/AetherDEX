// SPDX-License-Identifier: GPL-3.0

/*
Created by irfndi (github.com/irfndi) - Apr 2025
Email: join.mantap@gmail.com
*/

pragma solidity ^0.8.29;

import {MockERC20} from "./MockERC20.sol";

// Custom Errors for Mock
error ChainNotSupported(uint16 chainId);
error ZeroAddress();
error ChainNotConfigured(uint16 chainId);

contract MockChainNetworks {
    struct ChainInfo {
        string name;
        uint256 blockTime; // Block time in milliseconds
        uint256 baseFee;
        address[] supportedTokens;
    }

    mapping(uint16 => ChainInfo) public chainInfo;
    mapping(uint16 => mapping(address => address)) public nativeTokens;
    mapping(uint16 => uint256) public blockTimes;
    mapping(uint16 => uint256) public gasPrices;

    // Constants for gas calculations
    uint256 constant public GWEI = 1e9;
    uint256 constant public ETH = 1e18;

    // Chain IDs
    uint16 public constant ETHEREUM_CHAIN_ID = 1;
    uint16 public constant BSC_CHAIN_ID = 56;
    uint16 public constant ARBITRUM_CHAIN_ID = 42161;
    uint16 public constant OPTIMISM_CHAIN_ID = 10;
    uint16 public constant POLYGON_CHAIN_ID = 137;
    uint16 public constant AVALANCHE_CHAIN_ID = 43114;
    uint16 public constant BASE_CHAIN_ID = 8453;
    uint16 public constant ZKSYNC_CHAIN_ID = 324;
    uint16 public constant LINEA_CHAIN_ID = 59144;
    uint16 public constant POLYGON_ZKEVM_CHAIN_ID = 1101;

    // Events to mimic LayerZero interactions
    event MessageSent(uint16 indexed dstChainId, bytes path, uint256 value);
    event MessageReceived(uint16 indexed srcChainId, bytes srcAddress, uint64 nonce, bytes payload);
    event MockNoOp();

    constructor() {
        _setupChain(
            ETHEREUM_CHAIN_ID,
            "Ethereum",
            12000, // 12 seconds
            30 * GWEI,
            "ETH"
        );
        _setupChain(
            BSC_CHAIN_ID,
            "BSC",
            3000, // 3 seconds
            5 * GWEI,
            "BNB"
        );
        _setupChain(
            ARBITRUM_CHAIN_ID,
            "Arbitrum",
            250, // 0.25 seconds
            1 * GWEI / 10, // 0.1 gwei
            "ETH"
        );
        _setupChain(
            OPTIMISM_CHAIN_ID,
            "Optimism",
            2000, // 2 seconds
            1 * GWEI / 1000, // 0.001 gwei
            "ETH"
        );
        _setupChain(
            POLYGON_CHAIN_ID,
            "Polygon",
            2000, // 2 seconds
            50 * GWEI,
            "MATIC"
        );
        _setupChain(
            AVALANCHE_CHAIN_ID,
            "Avalanche",
            2000, // 2 seconds
            25 * GWEI,
            "AVAX"
        );
        _setupChain(
            BASE_CHAIN_ID,
            "Base",
            2000, // 2 seconds
            1 * GWEI / 1000, // 0.001 gwei
            "ETH"
        );
        _setupChain(
            ZKSYNC_CHAIN_ID,
            "zkSync",
            1000, // 1 second
            25 * GWEI / 100, // 0.25 gwei
            "ETH"
        );
        _setupChain(
            LINEA_CHAIN_ID,
            "Linea",
            2000, // 2 seconds
            5 * GWEI / 1000, // 0.005 gwei
            "ETH"
        );
        _setupChain(
            POLYGON_ZKEVM_CHAIN_ID,
            "Polygon zkEVM",
            2000, // 2 seconds
            1 * GWEI / 1000, // 0.001 gwei
            "ETH"
        );
    }

    function _setupChain(
        uint16 chainId,
        string memory name,
        uint256 blockTime,
        uint256 baseFee,
        string memory nativeTokenSymbol
    ) internal {
        address nativeToken = address(new MockERC20(nativeTokenSymbol, nativeTokenSymbol, 18));

        address[] memory tokens = new address[](1);
        tokens[0] = nativeToken;

        chainInfo[chainId] = ChainInfo({name: name, blockTime: blockTime, baseFee: baseFee, supportedTokens: tokens});

        nativeTokens[chainId][address(0)] = nativeToken;
        blockTimes[chainId] = blockTime;
        gasPrices[chainId] = baseFee;
    }

    function getNativeToken(uint16 chainId) external view returns (address) {
        return nativeTokens[chainId][address(0)];
    }

    function getChainInfo(uint16 chainId)
        external
        view
        returns (string memory name, uint256 blockTime, uint256 baseFee, address[] memory tokens)
    {
        ChainInfo storage info = chainInfo[chainId];
        return (info.name, info.blockTime, info.baseFee, info.supportedTokens);
    }

    function mintNativeToken(uint16 chainId, address _to, uint256 amount) external {
        if (_to == address(0)) revert ZeroAddress();
        address nativeToken = nativeTokens[chainId][address(0)];
        if (nativeToken == address(0)) revert ChainNotSupported(chainId);
        MockERC20(nativeToken).mint(_to, amount);
    }

    function getGasPrice(uint16 chainId) external view returns (uint256) {
        return gasPrices[chainId];
    }

    function getBlockTime(uint16 chainId) external view returns (uint256) {
        return blockTimes[chainId];
    }

    // Returns gas price in gwei
    function getGasPriceGwei(uint16 chainId) external view returns (uint256) {
        return gasPrices[chainId] / GWEI;
    }

    // Calculate transaction cost in native token
    function calculateTxCost(uint16 chainId, uint256 gasUsed) external view returns (uint256) {
        return (gasPrices[chainId] * gasUsed);
    }

    // Convert native token amount to USD (assuming ETH = $3000)
    function convertToUSD(uint16 /* chainId */, uint256 amount) external pure returns (uint256) {
        uint256 ethPrice = 3000e18; // $3000 per ETH
        return (amount * ethPrice) / ETH;
    }

    function addSupportedToken(uint16 chainId, address token) external {
        if (chainInfo[chainId].blockTime == 0) revert ChainNotConfigured(chainId);
        address[] storage tokens = chainInfo[chainId].supportedTokens;
        tokens.push(token);
    }

    // Utility function to convert block time from milliseconds to seconds
    function getBlockTimeInSeconds(uint16 chainId) external view returns (uint256) {
        return blockTimes[chainId] / 1000;
    }

    // Utility function to simulate cross-chain message latency
    function simulateMessageLatency(uint16 srcChain, uint16 dstChain) external view returns (uint256) {
        uint256 srcBlockTime = blockTimes[srcChain];
        uint256 dstBlockTime = blockTimes[dstChain];
        uint256 baseLatency = 5 minutes; // Base latency assumption

        // solhint-disable-next-line not-rely-on-time
        uint256 randomFactor = (block.timestamp % 1000); // Add some pseudo-randomness
        uint256 totalLatency = baseLatency + srcBlockTime + dstBlockTime + (randomFactor * 10); // In ms

        return totalLatency;
    }

    // Utility function to get network congestion multiplier (1.0 - 3.0x)
    function getNetworkCongestion(uint16 chainId) external view returns (uint256) {
        // Mock implementation - returns values between 100-300 (representing 1.0x-3.0x)
        // solhint-disable-next-line not-rely-on-time
        return 100 + (uint256(keccak256(abi.encode(chainId, block.timestamp))) % 200);
    }

    function isChainSupported(uint256 /*chainId*/) public view returns (bool) {
        // require(chainIdToLzChainId[chainId] != 0, "Chain not supported");
        // Simple mock: always return true for testing purposes
        return true;
    }

    function send(
        uint16 _dstChainId,
        bytes calldata _path, // Use bytes for path
        bytes calldata /* _message */, // Commented out unused parameter
        address payable /* _refundAddress */, // Commented out unused parameter
        address /* _zroPaymentAddress */, // Commented out unused parameter
        bytes calldata /* _adapterParams */, // Re-commented out unused parameter
        uint256 /* _nativeFee */ // Commented out unused parameter
    ) external payable { // Removed override
        // Simulate sending a LayerZero message
        // This mock doesn't need complex logic, just track calls or emit events if needed
        emit MessageSent(_dstChainId, _path, msg.value);
        // Simulate potential fee return
    }

    function lzSend(
        uint16 _dstChainId,
        bytes calldata _payload,
        address payable /* _refundAddress */, // Commented out unused parameter
        address /* _zroPaymentAddress */, // Commented out unused parameter
        bytes calldata /* _adapterParams */, // Commented out unused parameter
        uint256 /* _nativeFee */
     ) external payable { // Removed override
        // Simulate sending a message (simplified)
        emit MessageSent(_dstChainId, _payload, msg.value);
    }

    function lzReceive(
        uint16 _srcChainId,
        bytes calldata _srcAddress,
        uint64 _nonce,
        bytes calldata _payload
    ) external { 
        // Simulate receiving a message (simplified)
        emit MessageReceived(_srcChainId, _srcAddress, _nonce, _payload);
    }

    /**
     * @notice Estimate the fee for the cross-chain message.
     * @return nativeFee The estimated fee in native gas token.
     * @return zroFee The estimated fee in ZRO token.
     */
    function estimateFees(
        uint16, /* _dstChainId */
        address, /* _userApplication */
        bytes calldata, /* _payload */
        bool, /* _payInZRO */
        bytes calldata /* _adapterParams */
    ) external pure returns (uint256 nativeFee, uint256 zroFee) {
        // Mock implementation: return fixed fees
        nativeFee = 0.001 ether; // Example fee
        zroFee = 0; // Example fee
    }

    function getReceiveVersion(address /*_userApplication*/) external pure returns (uint8) { // Removed override
        // Return a mock version
        return 1;
    }

    function getSendVersion(address /*_userApplication*/) external pure returns (uint8) { // Removed override
        // Return a mock version
        return 1;
    }

    // --- ILayerZeroUserApplicationConfig specific functions ---
    // Implement required functions from ILayerZeroUserApplicationConfig if needed for tests
    // For basic mocking, these might not be strictly necessary
    function getConfig(uint16 /*_version*/, uint16 /*_chainId*/, address /*_userApplication*/, uint256 /*_configType*/) external pure returns (bytes memory) { // Removed override
        return bytes(""); // Return empty bytes for mock
    }

    function setConfig(uint16 /*_version*/, uint16 /*_chainId*/, uint256 /*_configType*/, bytes calldata /*_config*/) external { // Removed override
        emit MockNoOp();
    }

    // --- ILayerZeroOptions specific functions ---
    function setOptions(uint16 /*_dstChainId*/, uint256 /*_optionType*/, bytes calldata /*_options*/) external payable { // Removed override
        emit MockNoOp();
    }

    function getOptions(uint16 /*_dstChainId*/, uint256 /*_optionType*/) external pure returns (bytes memory) { // Removed override
        return bytes(""); // Return empty bytes for mock
    }

    // --- Utility functions ---
    /**
     * @notice Get LayerZero Chain ID based on native chain ID.
     * @return lzChainId The corresponding LayerZero chain ID.
     */
    function getLzChainId(uint256 /*_chainId*/) external pure returns (uint16 lzChainId) {
        // Simplified: return a fixed mock LZ ID for testing
        // A real implementation might use a mapping or complex logic
        // if (_chainId == 1) { // Example: Ethereum Mainnet
        //     return 101; // LayerZero ID for Ethereum
        // } else if (_chainId == 10) { // Example: Optimism
        //     return 111; // LayerZero ID for Optimism
        // } else if (_chainId == 42161) { // Example: Arbitrum One
        //     return 110; // LayerZero ID for Arbitrum
        // } else {
        //     revert Errors.UnsupportedChainId(_chainId); // Or return a default/error code
        // }
        // For mock, just return a plausible ID
        return 101; // Mock LZ ID (e.g., for Ethereum Mainnet)
    }
 }
