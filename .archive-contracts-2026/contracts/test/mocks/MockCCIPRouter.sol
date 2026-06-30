// SPDX-License-Identifier: GPL-3.0

/*
Created by irfndi (github.com/irfndi) - Apr 2025
Email: join.mantap@gmail.com
*/

pragma solidity ^0.8.31;

contract MockCCIPRouter {
    // Mapping to track available lanes between chains
    mapping(uint16 => mapping(uint16 => bool)) public lanes;
    // Mapping to track delivered messages between chains
    mapping(uint16 => mapping(uint16 => bool)) public _messageDelivered;
    // Mapping to track deposited tokens
    mapping(address => uint256) public depositedTokens;

    function estimateFees(uint16, address, bytes memory) external pure returns (uint256) {
        return 0.1 ether;
    }

    function sendMessage(uint16 dstChain, address, bytes memory) external payable returns (bool) {
        _messageDelivered[0][dstChain] = true;
        return true;
    }

    // Renamed for AetherRouter compatibility to avoid selector clash
    function sendCrossChainMessage(uint16 dstChain, address, bytes memory) external payable {
        _messageDelivered[0][dstChain] = true;
    }

    // Set lane availability between two chains
    function setLane(uint16 srcChain, uint16 dstChain, bool available) external {
        lanes[srcChain][dstChain] = available;
    }

    // Check if message was delivered between chains
    function messageDelivered(uint16 srcChain, uint16 dstChain) external view returns (bool) {
        return _messageDelivered[srcChain][dstChain];
    }

    // Implement depositToken function from ICCIPRouter interface
    function depositToken(address token, uint256 amount) external returns (bool) {
        depositedTokens[token] += amount;
        return true;
    }
}
