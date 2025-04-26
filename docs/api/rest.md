# REST API

This document details the HTTP-based REST API endpoints provided by AetherDEX for programmatic interaction with the platform.

## Base URL

```
https://api.aetherdex.io/v1
```

For sandbox/testing environments:

```
https://api.sandbox.aetherdex.io/v1
```

## Authentication

### Headers

All authenticated endpoints require the following headers:

```
AETHER-API-KEY: <your_api_key>
AETHER-SIGNATURE: <signature>
AETHER-TIMESTAMP: <timestamp>
```

### Signature Generation

Signatures must be generated using the following process:

```javascript
const timestamp = Date.now().toString();
const message = timestamp + method + endpoint + body;
const signature = HMAC-SHA256(message, apiSecret).toHex();
```

Example signature generation in JavaScript:

```javascript
const crypto = require('crypto');

function generateSignature(apiSecret, method, endpoint, body, timestamp) {
  const message = timestamp + method + endpoint + (body || '');
  return crypto
    .createHmac('sha256', apiSecret)
    .update(message)
    .digest('hex');
}

// Usage
const timestamp = Date.now().toString();
const signature = generateSignature(
  'YOUR_API_SECRET',
  'GET',
  '/v1/quotes',
  '',
  timestamp
);
```

Example signature generation in Python:

```python
import hmac
import hashlib
import time

def generate_signature(api_secret, method, endpoint, body, timestamp):
    message = f"{timestamp}{method}{endpoint}{body or ''}"
    signature = hmac.new(
        api_secret.encode('utf-8'),
        message.encode('utf-8'),
        hashlib.sha256
    ).hexdigest()
    return signature

# Usage
timestamp = str(int(time.time() * 1000))
api_secret = 'YOUR_API_SECRET'
signature = generate_signature(
    api_secret,
    'GET',
    '/v1/quote',
    '', # No request body for GET
    timestamp
)
```

## Endpoints

### Market Data

#### Get Token List

```
GET /tokens
```

Returns a list of supported tokens across all chains.

**Parameters:**
- `chainId` (optional): Filter tokens by chain ID

**Response:**
```json
{
  "tokens": [
    {
      "address": "0x1234...",
      "symbol": "ETH",
      "name": "Ethereum",
      "decimals": 18,
      "chainId": 1,
      "logoURI": "https://assets.aetherdex.io/tokens/eth.png"
    },
    ...
  ]
}
```

#### Get Price

```
GET /prices
```

Returns current prices for token pairs.

**Parameters:**
- `baseToken`: Base token address
- `quoteToken`: Quote token address
- `chainId`: Chain ID

**Response:**
```json
{
  "baseToken": "0x1234...",
  "quoteToken": "0xabcd...",
  "price": "0.05",
  "timestamp": 1637276970123,
  "24hChange": "+2.5%"
}
```

### Trading

#### Get Quote

```
GET /quote
```

Returns a price quote for a potential single-chain trade, detailing the expected exchange rate, fees, and liquidity sources. This quote is valid for a short period.

**Parameters:**

-   `sellToken` (string, required): Contract address of the token you want to sell.
-   `buyToken` (string, required): Contract address of the token you want to buy.
-   `sellAmount` (string, required): The amount of `sellToken` you want to sell, specified in the token's smallest unit (e.g., wei for ETH).
-   `chainId` (integer, required): The ID of the blockchain network where the swap will occur (e.g., `1` for Ethereum Mainnet).
-   `slippagePercentage` (number, optional): The maximum acceptable percentage difference between the quoted price and the execution price (e.g., `0.5` for 0.5%). Defaults to `0.5`.
-   `takerAddress` (string, optional): The wallet address initiating the trade. Required if using private liquidity sources or for gas estimation specific to the user.

**Example Request (`curl`):**

```bash
curl -X GET "https://api.aetherdex.io/v1/quote?sellToken=0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeE&buyToken=0x6B175474E89094C44Da98b954EedeAC495271d0F&sellAmount=1000000000000000000&chainId=1"
```

**Response:**

```json
{
  "chainId": 1, // The chain ID for which the quote is valid.
  "price": "3000.123", // The market price for 1 unit of sellToken in terms of buyToken (e.g., 1 ETH = 3000.123 DAI).
  "guaranteedPrice": "2985.121", // The minimum price guaranteed considering the specified slippagePercentage.
  "sellTokenAddress": "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeE", // Address of the token being sold (Native token represented by 0xeee...).
  "buyTokenAddress": "0x6B175474E89094C44Da98b954EedeAC495271d0F", // Address of the token being bought (DAI).
  "sellAmount": "1000000000000000000", // Amount of sellToken (1 ETH in wei).
  "buyAmount": "2985121000000000000000", // The minimum amount of buyToken the user will receive (in base units).
  "estimatedGas": "150000", // Estimated gas units required for the transaction.
  "gasPrice": "30000000000", // Estimated gas price in wei used for calculation.
  "protocolFee": "1500000000000000", // Fee paid to the protocol (in sellToken base units).
  "validTo": 1637277970, // Unix timestamp (seconds) until which this quote is valid.
  "sources": [ // Breakdown of liquidity sources used for this quote.
    {
      "name": "UniswapV3", // Name of the liquidity source.
      "proportion": "0.7" // Proportion of the trade routed through this source (0.0 to 1.0).
    },
    {
      "name": "SushiSwap",
      "proportion": "0.3"
    }
  ],
  // Optional fields for transaction execution (if using 0x API integration)
  "allowanceTarget": "0xdef1c0ded9bec7f1a1670819833240f027b25eff", // Address to grant allowance for sellToken.
  "to": "0xdef1c0ded9bec7f1a1670819833240f027b25eff", // Target contract address for the transaction.
  "data": "0x...", // Encoded transaction data to be sent.
  "value": "1000000000000000000" // Amount of native currency (e.g., ETH) to send with the transaction (if sellToken is native).
}
```

#### Submit Order

```
POST /order
```

Submits a new order to the AetherDEX network.

**Request Body:**
```json
{
  "sellToken": "0x1234...",
  "buyToken": "0xabcd...",
  "sellAmount": "1000000000000000000",
  "buyAmount": "50000000000000000",
  "takerAddress": "0x5678...",
  "expiry": 1637277970,
  "chainId": 1,
  "signature": "0x...",
  "slippagePercentage": 0.5
}
```

**Response:**
```json
{
  "orderId": "0x1234...",
  "status": "pending",
  "createdAt": 1637276970123
}
```

#### Get Order Status

```
GET /order/:orderId
```

Retrieves the current status of an order.

**Parameters:**
- `orderId`: ID of the order to query

**Response:**
```json
{
  "orderId": "0x1234...",
  "status": "filled", // pending, partial, filled, cancelled, expired, failed
  "chainId": 1,
  "sellToken": "0x1234...",
  "buyToken": "0xabcd...",
  "sellAmount": "1000000000000000000",
  "buyAmount": "50000000000000000",
  "filledSellAmount": "1000000000000000000",
  "filledBuyAmount": "50000000000000000",
  "transactionHash": "0x...",
  "createdAt": 1637276970123,
  "updatedAt": 1637276990123
}
```

### Cross-Chain Operations

#### Get Cross-Chain Quote

```
GET /cross-chain/quote
```

Returns a quote for a potential cross-chain swap, detailing the estimated output, fees, route, and time. This quote is valid for a short period.

**Parameters:**

-   `sourceChainId` (integer, required): The ID of the source blockchain network.
-   `destinationChainId` (integer, required): The ID of the target blockchain network.
-   `sellToken` (string, required): Contract address of the token to sell on the source chain.
-   `buyToken` (string, required): Contract address of the token to buy on the destination chain.
-   `sellAmount` (string, required): The amount of `sellToken` to sell, specified in the token's smallest unit (e.g., wei).
-   `slippagePercentage` (number, optional): Maximum acceptable slippage across the entire route (default: 1.0). Note: Cross-chain slippage can be higher.
-   `recipientAddress` (string, optional): The final recipient address on the destination chain. Defaults to the `takerAddress` if not provided.
-   `takerAddress` (string, optional): The wallet address initiating the trade on the source chain.

**Example Request (`curl`):**

```bash
curl -X GET "https://api.aetherdex.io/v1/cross-chain/quote?sourceChainId=1&destinationChainId=137&sellToken=0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeE&buyToken=0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174&sellAmount=1000000000000000000"
```

**Response:**

```json
{
  "sourceChainId": 1, // Source chain ID (Ethereum).
  "destinationChainId": 137, // Destination chain ID (Polygon).
  "sellTokenAddress": "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeE", // Sell token (ETH).
  "buyTokenAddress": "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174", // Buy token (USDC on Polygon).
  "sellAmount": "1000000000000000000", // Amount of sellToken (1 ETH in wei).
  "estimatedBuyAmount": "2950123456", // Estimated amount of buyToken received (in base units, e.g., 2950.12 USDC with 6 decimals).
  "minimumBuyAmount": "2920000000", // Minimum amount of buyToken guaranteed after slippage (e.g., 2920.00 USDC).
  "estimatedGasSourceChain": "250000", // Estimated gas units on the source chain.
  "estimatedGasDestinationChain": "180000", // Estimated gas units on the destination chain.
  "bridgeFee": { // Fees associated with the bridging/messaging protocol.
    "amount": "1000000000000000", // Fee amount in native token of source chain (e.g., 0.001 ETH).
    "token": "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeE" // Token address for the fee.
  },
  "protocolFee": { // AetherDEX protocol fee.
    "amount": "500000000000000", // Fee amount (e.g., 0.0005 ETH).
    "token": "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeE" // Token address for the fee.
  },
  "estimatedTime": 240, // Estimated total time in seconds for the transaction to complete.
  "validTo": 1637277970, // Unix timestamp (seconds) until which this quote is valid.
  "route": [ // Detailed steps involved in the cross-chain transaction.
    {
      "type": "swap", // Step type.
      "protocol": "UniswapV3", // Protocol/DEX used.
      "chainId": 1,
      "fromToken": "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeE",
      "toToken": "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", // e.g., Swap ETH to USDC on Ethereum.
      "estimatedOutput": "3000123456"
    },
    {
      "type": "bridge",
      "protocol": "LayerZero", // Bridging/messaging protocol used.
      "fromChainId": 1,
      "toChainId": 137,
      "bridgeToken": "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48" // Token being bridged (USDC).
    },
    {
      "type": "swap",
      "protocol": "QuickSwap",
      "chainId": 137,
      "fromToken": "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", // Bridged USDC address on Polygon might differ.
      "toToken": "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174", // Final swap to desired USDC version on Polygon.
      "estimatedOutput": "2950123456"
    }
  ],
  // Optional fields for transaction execution
  "approvalData": { // Details if token approval is needed on source chain.
      "allowanceTarget": "0x...", // Router/Contract needing approval.
      "minimumApprovalAmount": "1000000000000000000"
  },
  "transactionRequest": { // Data needed to initiate the transaction on the source chain.
      "to": "0x...", // AetherRouter address on source chain.
      "data": "0x...", // Encoded function call data.
      "value": "1001000000000000000" // Native token amount to send (sellAmount + bridgeFee + protocolFee if native).
  }
}
```

#### Submit Cross-Chain Order

```
POST /cross-chain/order
```

Submits a new cross-chain order.

**Request Body:**
```json
{
  "sourceChainId": 1,
  "destinationChainId": 137,
  "sellToken": "0x1234...",
  "buyToken": "0xabcd...",
  "sellAmount": "1000000000000000000",
  "minBuyAmount": "950000000000000000",
  "takerAddress": "0x5678...",
  "destinationAddress": "0x5678...",
  "expiry": 1637277970,
  "slippagePercentage": 0.5,
  "signature": "0x..."
}
```

**Response:**
```json
{
  "orderId": "0x1234...",
  "status": "bridgePending", // sourceChainPending, bridgePending, destinationChainPending, completed, failed
  "createdAt": 1637276970123,
  "sourceChainTxHash": "0x...",
  "trackingUrl": "https://bridge.aetherdex.io/tx/0x..."
}
```

### Account Data

#### Get Balances

```
GET /balances
```

Returns token balances for a wallet address.

**Parameters:**
- `address`: Wallet address
- `chainId` (optional): Chain ID to filter by

**Response:**
```json
{
  "address": "0x1234...",
  "balances": [
    {
      "token": "0x1234...",
      "symbol": "ETH",
      "balance": "1000000000000000000",
      "chainId": 1
    },
    {
      "token": "0xabcd...",
      "symbol": "USDC",
      "balance": "500000000", // 500 USDC with 6 decimals
      "chainId": 1
    }
  ]
}
```

#### Get Transaction History

```
GET /transactions
```

Returns historical transactions for a wallet address.

**Parameters:**
- `address`: Wallet address
- `chainId` (optional): Chain ID to filter by
- `limit` (optional): Number of results to return (default: 50, max: 100)
- `offset` (optional): Pagination offset
- `type` (optional): Transaction type filter (swap, bridge, liquidity)

**Response:**
```json
{
  "address": "0x1234...",
  "transactions": [
    {
      "id": "0x...",
      "type": "swap",
      "chainId": 1,
      "status": "completed",
      "sellToken": "0x1234...",
      "sellAmount": "1000000000000000000",
      "buyToken": "0xabcd...",
      "buyAmount": "50000000000000000",
      "timestamp": 1637276970123,
      "transactionHash": "0x..."
    },
    {
      "id": "0x...",
      "type": "bridge",
      "sourceChainId": 1,
      "destinationChainId": 137,
      "status": "completed",
      "sellToken": "0x1234...",
      "sellAmount": "1000000000000000000",
      "buyToken": "0xabcd...",
      "buyAmount": "975000000000000000",
      "timestamp": 1637276970123,
      "sourceTransactionHash": "0x...",
      "destinationTransactionHash": "0x..."
    }
  ],
  "pagination": {
    "total": 156,
    "limit": 50,
    "offset": 0
  }
}
```

## Error Responses

All API errors return with appropriate HTTP status codes and a consistent error format:

```json
{
  "error": {
    "code": "INSUFFICIENT_FUNDS",
    "message": "Insufficient funds for transaction",
    "details": {
      "required": "1.5 ETH",
      "available": "1.2 ETH"
    }
  }
}
```

Common error codes:

| Code | Description |
|------|-------------|
| INVALID_PARAMETERS | Missing or invalid request parameters |
| INSUFFICIENT_FUNDS | Wallet has insufficient funds |
| PRICE_EXPIRED | Quote has expired and needs refreshing |
| RATE_LIMITED | API rate limit exceeded |
| AUTHORIZATION_REQUIRED | Missing or invalid API credentials |
| SIGNATURE_INVALID | Request signature verification failed |
| SLIPPAGE_EXCEEDED | Execution would exceed slippage tolerance |
| LIQUIDITY_UNAVAILABLE | Insufficient liquidity for requested amount |
| SYSTEM_UNAVAILABLE | API system temporarily unavailable |

## Pagination

Endpoints that return lists support standard pagination parameters:

- `limit`: Number of results to return
- `offset`: Pagination offset

Response includes pagination metadata:

```json
{
  "data": [...],
  "pagination": {
    "total": 156,
    "limit": 50,
    "offset": 0
  }
}
```

## API Status

Service status can be checked at:
```
GET /status
```

Response:
```json
{
  "status": "operational", // operational, degraded, maintenance, outage
  "version": "1.0.5",
  "timestamp": 1637276970123
}
```

## Rate Limits

Current rate limit status can be checked in response headers:

```
AETHER-RATE-LIMIT-LIMIT: 10
AETHER-RATE-LIMIT-REMAINING: 9
AETHER-RATE-LIMIT-RESET: 1637277030123
```

For detailed information on error handling and best practices, see our [API Integration Guidelines](https://docs.aetherdex.io/api/guidelines).
