// SPDX-License-Identifier: GPL-3.0

/*
Created by irfndi (github.com/irfndi) - Apr 2025
Email: join.mantap@gmail.com
*/

pragma solidity ^0.8.29;

/**
 * @title MockAetherFactory
 * @notice Basic mock for AetherFactory, primarily to provide an address.
 */
contract MockAetherFactory {
    // No specific logic needed for current router tests
    // The AetherPool constructor only requires the factory address.

    event MockConstructorCalled();

    constructor() {
        emit MockConstructorCalled();
    }
}
