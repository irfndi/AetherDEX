// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.29;

import {MockERC20} from "./MockERC20.sol";

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
    uint256 constant GWEI = 1e9;
    uint256 constant ETH = 1e18;

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
        address nativeToken = address(new MockERC20(
            nativeTokenSymbol,
            nativeTokenSymbol,
            18
        ));

        address[] memory tokens = new address[](1);
        tokens[0] = nativeToken;

        chainInfo[chainId] = ChainInfo({
            name: name,
            blockTime: blockTime,
            baseFee: baseFee,
            supportedTokens: tokens
        });

        nativeTokens[chainId][address(0)] = nativeToken;
        blockTimes[chainId] = blockTime;
        gasPrices[chainId] = baseFee;
    }

    function getNativeToken(uint16 chainId) external view returns (address) {
        return nativeTokens[chainId][address(0)];
    }

    function getChainInfo(uint16 chainId) external view returns (
        string memory name,
        uint256 blockTime,
        uint256 baseFee,
        address[] memory tokens
    ) {
        ChainInfo storage info = chainInfo[chainId];
        return (
            info.name,
            info.blockTime,
            info.baseFee,
            info.supportedTokens
        );
    }

    function mintNativeToken(uint16 chainId, address to, uint256 amount) external {
        address nativeToken = nativeTokens[chainId][address(0)];
        require(nativeToken != address(0), "Chain not supported");
        MockERC20(nativeToken).mint(to, amount);
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
    function convertToUSD(uint16 chainId, uint256 amount) external pure returns (uint256) {
        uint256 ethPrice = 3000e18; // $3000 per ETH
        return (amount * ethPrice) / ETH;
    }

    function addSupportedToken(uint16 chainId, address token) external {
        require(chainInfo[chainId].blockTime > 0, "Chain not configured");
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
        return ((srcBlockTime + dstBlockTime) * 3) / 1000; // Average confirmation time in seconds
    }

    // Utility function to get network congestion multiplier (1.0 - 3.0x)
    function getNetworkCongestion(uint16 chainId) external view returns (uint256) {
        // Mock implementation - returns values between 100-300 (representing 1.0x-3.0x)
        return 100 + (uint256(keccak256(abi.encode(chainId, block.timestamp))) % 200);
    }
}
