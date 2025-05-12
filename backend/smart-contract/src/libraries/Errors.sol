// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title Errors
 * @dev Contract for declaring custom error types to be used across the AetherDEX protocol.
 * Using custom errors is more gas-efficient than string reasons for revert.
 */
library Errors {
    // Router and Swap Errors
    error DeadlineExpired();
    error InsufficientOutputAmount();
    error InsufficientLiquidityMinted();
    error InsufficientAAmount();
    error InsufficientBAmount();
    error PathLengthTooShort(); 
    error InvalidPath();        
    error IdenticalAddresses(); 
    error ZeroAddress();        

    // Cross-Chain Specific Errors
    error InvalidAmountIn();
    error ExcessiveSlippage();
    error ApprovalFailed();
    error InvalidDstChain();
    error InvalidSrcChain();
    error BridgeOperationFailed();
    error InvalidPayload();

    // General Access Control & State
    error NotOwner(); // Equivalent to Ownable's revert strings
    error Paused();   // Equivalent to Pausable's revert strings
    error NotPaused(); // Equivalent to Pausable's revert strings
    error Reentrancy(); 

    // Liquidity Pool Errors
    error InsufficientLiquidity();
    error AmountTooLow();
    error KInvariantFailed(); 
}
