// SPDX-License-Identifier: GPL-3.0

/*
Created by irfndi (github.com/irfndi) - Apr 2025
Email: join.mantap@gmail.com
*/

pragma solidity ^0.8.31;

contract MockHyperlane {
    // Mapping to track available routes between chains
    mapping(uint16 => mapping(uint16 => bool)) public routes;
    // Mapping to track verified messages between chains
    mapping(uint16 => mapping(uint16 => bool)) private _verified;
    // Mapping to track deposited tokens
    mapping(address => uint256) public depositedTokens;

    function quoteDispatch(uint16, bytes memory) external pure returns (uint256) {
        return 0.1 ether;
    }

    function sendMessage(uint16 srcChain, uint16 dstChain, bytes memory) external payable {
        _verified[srcChain][dstChain] = true;
    }

    // Overload for AetherRouter compatibility
    function sendMessage(uint16 dstChain, address, bytes memory) external payable {
        _verified[0][dstChain] = true;
    }

    // Set route availability between two chains
    function setRoute(uint16 srcChain, uint16 dstChain, bool available) external {
        routes[srcChain][dstChain] = available;
    }

    // Check if message was verified between chains
    function isVerified(uint16 srcChain, uint16 dstChain) external view returns (bool) {
        return _verified[srcChain][dstChain];
    }

    // Implement dispatch function from IHyperlane interface
    function dispatch(uint16 destination, bytes calldata, bytes calldata) external payable returns (bytes32) {
        _verified[0][destination] = true;
        // Return a non-zero value to simulate successful dispatch acceptance in mock
        return bytes32(uint256(1));
    }

    // Implement process function from IHyperlane interface
    function process(
        uint16 origin,
        uint16 destination,
        address, /* sender */
        address, /* recipient */
        bytes calldata /* message */
    )
        external
        payable
    {
        _verified[origin][destination] = true;
    }

    // Implement isRouteEnabled function from IHyperlane interface
    function isRouteEnabled(uint16 srcChainId, uint16 dstChainId) external view returns (bool) {
        return routes[srcChainId][dstChainId];
    }

    // Implement estimateGasPayment function from IHyperlane interface
    function estimateGasPayment(
        uint16,
        /* destination */
        uint256 /* gasAmount */
    )
        external
        pure
        returns (uint256)
    {
        return 0.01 ether;
    }

    // Implement depositToken function from IHyperlane interface
    function depositToken(address token, uint256 amount) external returns (bool) {
        depositedTokens[token] += amount;
        return true;
    }
}
