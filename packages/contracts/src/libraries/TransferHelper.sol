// SPDX-License-Identifier: GPL-3.0

/*
Created by irfndi (github.com/irfndi) - Apr 2025
Email: join.mantap@gmail.com
*/

pragma solidity ^0.8.31;

/**
 * @title TransferHelper
 * @author AetherDEX
 * @notice Library for safe token transfer functions.
 * @dev Uses assembly to perform raw token calls and handle failures.
 */
library TransferHelper {
    /**
     * @notice Safely transfers tokens, reverting on failure.
     * @param token Address of the token contract.
     * @param to Address to transfer tokens to.
     * @param value Amount of tokens to transfer.
     */
    function safeTransfer(address token, address to, uint256 value) internal {
        (bool success, bytes memory data) = token.call(abi.encodeWithSelector(0xa9059cbb, to, value));
        require(success && (data.length == 0 || abi.decode(data, (bool))), "TRANSFER_FAILED");
    }

    /**
     * @notice Safely transfers tokens from an address, reverting on failure.
     * @param token Address of the token contract.
     * @param from Address to transfer tokens from.
     * @param to Address to transfer tokens to.
     * @param value Amount of tokens to transfer.
     */
    function safeTransferFrom(address token, address from, address to, uint256 value) internal {
        (bool success, bytes memory data) = token.call(abi.encodeWithSelector(0x23b872dd, from, to, value));
        require(success && (data.length == 0 || abi.decode(data, (bool))), "TRANSFER_FROM_FAILED");
    }

    /**
     * @notice Safely gets the balance of a token for this contract, reverting on failure.
     * @param token Address of the token contract.
     * @param poolAddress Address of the pool contract to check balance of. // ADD POOLADDRESS PARAM
     * @return uint256 Balance of the token.
     */
    function safeBalance(address token, address poolAddress) internal view returns (uint256) {
        // ADD poolAddress PARAMETER
        (bool success, bytes memory data) =
            token.staticcall(
                abi.encodeWithSelector(0x70a08231, poolAddress) // USE poolAddress PARAMETER
            );
        require(success, "BALANCE_READ_FAILED");
        return abi.decode(data, (uint256));
    }
}
