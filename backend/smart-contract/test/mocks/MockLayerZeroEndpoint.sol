// SPDX-License-Identifier: GPL-3.0

/*
Created by irfndi (github.com/irfndi) - Apr 2025
Email: join.mantap@gmail.com
*/

pragma solidity ^0.8.29;

import {ILayerZeroEndpoint} from "../../src/interfaces/ILayerZeroEndpoint.sol";

/**
 * @title MockLayerZeroEndpoint
 * @notice Mock implementation of LayerZero endpoint for testing
 */
contract MockLayerZeroEndpoint is ILayerZeroEndpoint {
    mapping(uint16 => address) public remoteEndpoints;
    mapping(address => bool) public trustedRemotes;
    uint256 public constant DEFAULT_GAS_LIMIT = 200000;

    // Custom Errors
    error UntrustedRemote(address remote);

    event MessageSent(uint16 dstChainId, bytes destination, bytes payload);

    event MessageReceived(uint16 srcChainId, bytes srcAddress, address dstAddress, uint64 nonce, bytes payload);

    function setTrustedRemote(address _remote, bool _trusted) external {
        trustedRemotes[_remote] = _trusted;
    }

    function setRemoteEndpoint(uint16 _chainId, address _endpoint) external {
        remoteEndpoints[_chainId] = _endpoint;
    }

    function send(
        uint16 _dstChainId,
        bytes calldata _destination,
        bytes calldata _payload,
        address payable /*_refundAddress*/,
        address /*_zroPaymentAddress*/,
        bytes calldata /*_adapterParams*/
    ) external payable override {
        // require(remoteEndpoints[_dstChainId] != address(0), "No remote endpoint");
        // Mock implementation: emit event
        emit MessageSent(_dstChainId, _destination, _payload);
    }

    function estimateFees(
        uint16 /*_dstChainId*/,
        address /*_userApplication*/,
        bytes calldata /*_payload*/,
        bool _payInZRO,
        bytes calldata /*_adapterParam*/
    ) external pure override returns (uint256 nativeFee, uint256 zroFee) {
        // uint16 _dstChainId,
        // address _userApplication,
        // bytes calldata _payload,
        // bool _payInZRO,
        // bytes calldata _adapterParam
        return (_payInZRO ? 0 : 0.01 ether, _payInZRO ? 1 ether : 0);
    }

    function receivePayload(
        uint16 _srcChainId,
        bytes memory _srcAddress,
        address _dstAddress,
        uint64 _nonce,
        bytes memory _payload
    ) external {
        if (!trustedRemotes[msg.sender]) revert UntrustedRemote(msg.sender);
        emit MessageReceived(_srcChainId, _srcAddress, _dstAddress, _nonce, _payload);
    }

    // These functions are required by the interface but not implemented in the mock
    function getInboundNonce(uint16, bytes calldata) external pure returns (uint64) {
        return 0;
    }

    function getSendLibraryAddress(address) external pure returns (address) {
        return address(0);
    }

    function getReceiveLibraryAddress(address) external pure returns (address) {
        return address(0);
    }
}
