// SPDX-License-Identifier: MIT
pragma solidity ^0.8.31;

/// @title AetherDEX Errors
/// @notice Custom errors for AetherDEX contracts
library Errors {
    error ZeroAddress();
    error ZeroAmount();
    error InvalidAmount();
    error InvalidPair();
    error InvalidFee();
    error PoolAlreadyExists();
    error PoolNotFound();
    error InsufficientLiquidity();
    error SlippageExceeded(uint256 expected, uint256 actual);
    error DeadlineExpired();
    error Unauthorized();
    error InvalidPath();
    error InvalidAction();
    error PoolIndexOutOfBounds();
}
