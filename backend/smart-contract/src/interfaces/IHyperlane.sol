// SPDX-License-Identifier: GPL-3.0

/*
Created by irfndi (github.com/irfndi) - Apr 2025
Email: join.mantap@gmail.com
*/

pragma solidity ^0.8.29;

interface IHyperlane {
    function setRoute(uint16 srcChainId, uint16 dstChainId, bool enabled) external;
    function dispatch(uint16 destination, bytes calldata recipient, bytes calldata message)
        external
        payable
        returns (bytes32);
    function process(uint16 origin, uint16 destination, address sender, address recipient, bytes calldata message)
        external
        payable;
    function isVerified(uint16 srcChainId, uint16 dstChainId) external view returns (bool);
    function quoteDispatch(uint16 destination, bytes calldata message) external view returns (uint256);
    function isRouteEnabled(uint16 srcChainId, uint16 dstChainId) external view returns (bool);
    function estimateGasPayment(uint16 destination, uint256 gasAmount) external view returns (uint256);
}
