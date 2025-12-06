# AetherDEX SDK Integration

This document provides guidance on integrating with AetherDEX using our official Software Development Kits (SDKs). Our SDKs simplify interaction with AetherDEX smart contracts and APIs across various programming languages.

## Overview

The AetherDEX SDKs aim to provide developers with easy-to-use tools for:

-   Fetching market data (prices, quotes, tokens)
-   Executing single-chain and cross-chain swaps
-   Managing liquidity positions (future)
-   Interacting with AetherDEX smart contracts directly
-   Subscribing to real-time data via WebSockets

## Available SDKs

*   **JavaScript/TypeScript SDK:** (Primary SDK)
    *   Status: **In Development**
    *   Repository: [Link to GitHub Repo - TBD]
    *   Package Manager: `bun add @aetherdex/sdk` (Placeholder)
*   **Python SDK:**
    *   Status: **Planned**
    *   Repository: [Link to GitHub Repo - TBD]
    *   Package Manager: `pip install aetherdex-sdk` (Placeholder)
*   **Go SDK:**
    *   Status: **Planned**
    *   Repository: [Link to GitHub Repo - TBD]

## JavaScript/TypeScript SDK Usage (Conceptual)

The following examples illustrate the intended usage patterns for the JS/TS SDK. *Note: These are conceptual and subject to change.*

### Installation

```bash
bun add @aetherdex/sdk ethers
```

### Initialization

```typescript
import { AetherSDK } from '@aetherdex/sdk';
import { ethers } from 'ethers';

// Configure provider (e.g., Infura, Alchemy, or browser wallet provider)
const provider = new ethers.providers.JsonRpcProvider('YOUR_RPC_URL');
// Or use browser provider: const provider = new ethers.providers.Web3Provider(window.ethereum);

const sdk = new AetherSDK({
  chainId: 1, // Default chain ID (e.g., Ethereum Mainnet)
  provider: provider,
  // Optional: signer for executing transactions
  // signer: provider.getSigner(),
  // Optional: API key for authenticated endpoints
  // apiKey: 'YOUR_API_KEY',
});
```

### Fetching Quotes

```typescript
async function getSwapQuote() {
  try {
    const quoteParams = {
      sellToken: 'ETH', // Can use symbol or address
      buyToken: 'DAI',
      sellAmount: ethers.utils.parseEther('1.0'), // Use ethers.utils for amounts
      chainId: 1,
      // Optional params: slippagePercentage, takerAddress
    };
    const quote = await sdk.getQuote(quoteParams);

    console.log('Received Quote:', quote);
    console.log(`Estimated Buy Amount: ${ethers.utils.formatUnits(quote.buyAmount, 18)} DAI`); // Format based on buyToken decimals

    // Use quote.transactionRequest for execution
    // const tx = await signer.sendTransaction(quote.transactionRequest);
    // console.log('Transaction Hash:', tx.hash);

  } catch (error) {
    console.error('Error fetching quote:', error);
  }
}

getSwapQuote();
```

### Fetching Cross-Chain Quotes

```typescript
async function getCrossChainQuote() {
  try {
    const quoteParams = {
      sourceChainId: 1, // Ethereum
      destinationChainId: 137, // Polygon
      sellToken: 'ETH',
      buyToken: 'USDC', // USDC on Polygon
      sellAmount: ethers.utils.parseEther('0.5'),
      // Optional params: slippagePercentage, recipientAddress, takerAddress
    };
    const quote = await sdk.getCrossChainQuote(quoteParams);

    console.log('Received Cross-Chain Quote:', quote);
    console.log(`Estimated Buy Amount on Polygon: ${ethers.utils.formatUnits(quote.estimatedBuyAmount, 6)} USDC`); // USDC has 6 decimals

    // Use quote.transactionRequest for execution on source chain
    // const tx = await signer.sendTransaction(quote.transactionRequest);
    // console.log('Source Transaction Hash:', tx.hash);

  } catch (error) {
    console.error('Error fetching cross-chain quote:', error);
  }
}

getCrossChainQuote();
```

### WebSocket Subscriptions (Conceptual)

```typescript
// Assuming sdk is initialized

// Subscribe to Ticker
const tickerSubscription = sdk.ws.subscribeTicker({
  pairs: ['ETH-USDC', 'WBTC-USDC'],
  chainId: 1,
}, (tickerData) => {
  console.log('Ticker Update:', tickerData);
});

// Subscribe to Orderbook
const orderbookSubscription = sdk.ws.subscribeOrderbook({
  pair: 'ETH-USDC',
  chainId: 1,
  depth: 20,
}, (orderbookData) => {
  console.log('Orderbook Update:', orderbookData);
});

// Unsubscribe later
// tickerSubscription.unsubscribe();
// orderbookSubscription.unsubscribe();
```

## Contributing

We welcome contributions to our SDKs. Please refer to the respective repository READMEs for contribution guidelines once they are available.

## Support

For questions or issues regarding SDK integration, please reach out on our [Discord community](https://discord.gg/aetherdex) in the #developers channel.
