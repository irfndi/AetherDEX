# AetherRouter Contract

The AetherRouter contract is the central entry point for trading operations in the AetherDEX protocol. This document provides a comprehensive technical overview of its architecture, functions, and security mechanisms.

## Contract Overview

The AetherRouter serves as:

1. A universal entry point for all user interactions
2. A coordinator for multi-step, multi-contract operations
3. A security layer for transaction validation and access control
4. A routing engine for optimizing trade execution

## Architecture

### Contract Structure

The AetherRouter follows a modular architecture:

```
AetherRouter
├── Core Logic
│   ├── Trade Execution
│   ├── Liquidity Management
│   └── Fee Processing
├── Security Layer
│   ├── Access Control
│   ├── Input Validation
│   └── Emergency Controls
├── Adapter Layer
│   ├── DEX Adapters
│   ├── Bridge Adapters
│   └── Protocol Adapters
└── Utility Layer
    ├── Fee Calculation
    ├── Signature Verification
    └── Event Emission
```

### Upgrade Mechanism

The AetherRouter uses a proxy pattern for upgradeability:

1. **Implementation Contract**: Contains the logic code
2. **Proxy Contract**: Stores state and delegates calls to the implementation
3. **Admin Contract**: Manages proxy upgrade permissions
4. **Timelock**: Enforces delay periods for upgrades

## Core Functions

### Trade Execution

```solidity
function executeSwap(
    SwapDescription memory desc,
    bytes memory data
) external payable returns (uint256 returnAmount);
```

Executes a token swap according to the provided parameters.

Parameters:
- `desc`: Structure containing swap details (tokens, amounts, recipient, etc.)
- `data`: Additional data required for the swap execution

### Multi-Hop Routing

```solidity
function executeMultiHopSwap(
    SwapStep[] memory steps,
    address recipient,
    uint256 deadline
) external payable returns (uint256 returnAmount);
```

Executes a multi-step swap through different liquidity sources.

Parameters:
- `steps`: Array of individual swap steps
- `recipient`: Address to receive the output tokens
- `deadline`: Timestamp after which the transaction will revert

### Cross-Chain Swaps

```solidity
function executeCrossChainSwap(
    uint256 targetChainId,
    CrossChainSwapDescription memory desc,
    bytes memory bridgeData
) external payable returns (bytes32 messageId);
```

Initiates a swap that continues on another blockchain.

Parameters:
- `targetChainId`: Destination blockchain identifier
- `desc`: Cross-chain swap parameters
- `bridgeData`: Bridge-specific data for the cross-chain message

## Security Features

### Access Control

The contract implements a role-based access control system:

1. **Admin Role**: Can upgrade the implementation and set critical parameters
2. **Operator Role**: Can update fee structures and maintenance settings
3. **Pauser Role**: Can trigger emergency pause functionality

### Circuit Breakers

Emergency mechanisms to protect user funds:

1. **Pause Functionality**: Halts all or specific functions during anomalies
2. **Token Blacklisting**: Prevents interactions with compromised tokens
3. **Gas Price Guards**: Protection against unfavorable network conditions
4. **Value Limits**: Transaction size restrictions based on risk assessment

### Input Validation

Comprehensive validation for all user inputs:

1. **Slippage Protection**: Minimum output enforcement
2. **Deadline Checks**: Transaction timeframe validation
3. **Address Validation**: Protection against common address errors
4. **Amount Checks**: Prevention of underflow/overflow scenarios

## Gas Optimization

Several techniques are employed to minimize gas costs:

1. **Batched Operations**: Combining multiple operations to save on fixed costs
2. **Assembly Usage**: Selective use of inline assembly for gas-intensive operations
3. **Storage Layout**: Optimized packing of storage variables
4. **Calldata Usage**: Preferring calldata over memory where appropriate

## Integration Patterns

### Direct Contract Calls

Example of a direct swap integration:

```solidity
// Approve tokens first
IERC20(tokenIn).approve(address(router), amountIn);

// Execute the swap
router.executeSwap(
    SwapDescription({
        tokenIn: tokenIn,
        tokenOut: tokenOut,
        amountIn: amountIn,
        minAmountOut: minAmountOut,
        recipient: recipient,
        deadline: block.timestamp + 300
    }),
    "0x" // No additional data
);
```

### Call with Permit

Example using EIP-2612 permit for gasless approvals:

```solidity
router.executeSwapWithPermit(
    SwapDescription({
        tokenIn: tokenIn,
        tokenOut: tokenOut,
        amountIn: amountIn,
        minAmountOut: minAmountOut,
        recipient: recipient,
        deadline: deadline
    }),
    "0x", // No additional data
    PermitData({
        v: v,
        r: r,
        s: s,
        deadline: deadline
    })
);
```

## Events

Key events emitted by the contract:

```solidity
event Swap(
    address indexed sender,
    address indexed tokenIn,
    address indexed tokenOut,
    uint256 amountIn,
    uint256 amountOut,
    address recipient
);

event CrossChainSwapInitiated(
    address indexed sender,
    uint256 indexed targetChainId,
    bytes32 indexed messageId,
    address tokenIn,
    uint256 amountIn
);

event FeesCollected(
    address indexed tokenAddress,
    uint256 amount,
    address collector
);
```

## Contract Addresses

| Network | Address | Version |
|---------|---------|---------|
| Ethereum | 0x12345... | v1.0.0 |
| BSC | 0xabcde... | v1.0.0 |
| Arbitrum | 0x67890... | v1.0.0 |
| Optimism | 0xfedcb... | v1.0.0 |
| Polygon | 0x45678... | v1.0.0 |

For the most current contract addresses, please refer to our [official deployment registry](https://github.com/AetherDEX/deployments).

## Security Considerations

When integrating with the AetherRouter contract:

1. Always check returned amounts against expected minimums
2. Set reasonable but safe deadlines for transactions
3. Implement proper error handling for failed transactions
4. Consider potential MEV exposure in transaction design
5. Review permission requirements before approving tokens

## Related Documentation

For more details on related components:
- [Interoperability Architecture](./interoperability.md)
- [Liquidity Sources & Aggregation](./liquidity-aggregation.md)
