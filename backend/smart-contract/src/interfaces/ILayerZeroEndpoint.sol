// SPDX-License-Identifier: GPL-3.0
// ILayerZeroEndpoint.sol
pragma solidity ^0.8.29; // UPDATED PRAGMA VERSION TO 0.8.28

interface ILayerZeroEndpoint {
    function send(
        uint16 _dstChainId,
        bytes calldata _destination,
        bytes calldata _payload,
        address payable _refundAddress,
        address _zroPaymentAddress,
        bytes calldata _adapterParams
    ) external payable;
}
