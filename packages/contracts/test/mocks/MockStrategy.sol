// SPDX-License-Identifier: GPL-3.0

/*
Created by irfndi (github.com/irfndi) - Apr 2025
Email: join.mantap@gmail.com
*/

pragma solidity ^0.8.29;

/**
 * @title MockStrategy
 * @dev A simple mock contract to represent a strategy for AetherVault tests.
 * Allows tests to impersonate this contract to call strategy-only functions.
 */
contract MockStrategy {
    // This contract can be empty for testing purposes,
    // as its primary role is to provide an address for the 'onlyStrategy' modifier.
    // Optional: Add a dummy function if interaction is needed later
    // function executeStrategyAction() external {}

    }
