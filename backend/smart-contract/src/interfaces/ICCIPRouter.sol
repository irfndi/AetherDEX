// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.29;

interface ICCIPRouter {
    function setLane(uint16 srcChainId, uint16 dstChainId, bool enabled) external;
    function sendMessage(
        uint16 destinationChainId,
        address receiver,
        bytes calldata payload
    ) external payable returns (bytes32);
    function isLaneEnabled(uint16 srcChainId, uint16 dstChainId) external view returns (bool);
    function estimateFees(
        uint16 destinationChainId,
        address receiver,
        bytes calldata payload
    ) external view returns (uint256);
}
