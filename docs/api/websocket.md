# WebSocket API

The AetherDEX WebSocket API provides real-time data streams for market information, order updates, and blockchain events. This document explains how to connect to and utilize these WebSocket endpoints.

## Connection Details

### WebSocket Endpoint

```
wss://ws.aetherdex.io/v1
```

For sandbox/testing environments:

```
wss://ws.sandbox.aetherdex.io/v1
```

### Authentication

WebSocket connections require authentication using one of these methods:

#### Method 1: Query Parameters

Connect with API key and signature in the URL:

```
wss://ws.aetherdex.io/v1?apiKey=YOUR_API_KEY&timestamp=TIMESTAMP&signature=SIGNATURE
```

The signature is generated using:
```javascript
const message = timestamp + 'GET' + '/v1';
const signature = HMAC-SHA256(message, apiSecret).toHex();
```

#### Method 2: Authentication Message

Connect to the WebSocket endpoint without parameters, then send an authentication message:

```javascript
// Initial connection
const ws = new WebSocket('wss://ws.aetherdex.io/v1');

// After connection is established
ws.on('open', () => {
  const timestamp = Date.now().toString();
  const message = timestamp + 'GET' + '/v1';
  const signature = calculateHmacSha256(message, API_SECRET);
  
  ws.send(JSON.stringify({
    type: 'authenticate',
    apiKey: API_KEY,
    timestamp: timestamp,
    signature: signature
  }));
});
```

### Connection Lifecycle

1. **Establish Connection**: Connect to the WebSocket endpoint
2. **Authenticate**: Send authentication message or use query parameters
3. **Subscribe**: Subscribe to specific data channels
4. **Receive Data**: Process incoming messages
5. **Heartbeat**: Respond to ping messages to maintain connection
6. **Disconnect**: Close connection when no longer needed

## Message Format

All WebSocket messages follow a consistent JSON format:

```json
{
  "type": "message_type",
  "channel": "channel_name",
  "data": {
    // Message-specific data
  },
  "timestamp": 1637276970123
}
```

### Message Types

| Type | Description |
|------|-------------|
| `authenticate` | Authentication message |
| `subscribe` | Channel subscription request |
| `unsubscribe` | Channel unsubscription request |
| `response` | Response to a client request |
| `data` | Data update from subscribed channel |
| `error` | Error notification |
| `ping` | Server heartbeat |
| `pong` | Client heartbeat response |

## Channels

### Market Data Channels

#### Ticker Channel

Provides real-time updates on market statistics (price, volume, change) for specified trading pairs on a given chain.

**Subscription:**

To subscribe, send a message with `type: "subscribe"` and `channel: "ticker"`.

```json
{
  "type": "subscribe",
  "channel": "ticker",
  "params": {
    "pairs": ["ETH-USDC", "WBTC-USDC"], // Array of trading pairs (e.g., BASE-QUOTE). Required.
    "chainId": 1 // The blockchain network ID. Required.
  }
}
```

**Data Message:**

Once subscribed, you will receive messages with `type: "data"` containing the latest ticker information.

```json
{
  "type": "data",
  "channel": "ticker",
  "data": {
    "pair": "ETH-USDC", // The trading pair for this update.
    "chainId": 1, // The chain ID for this pair.
    "lastPrice": "1850.25", // The price of the last executed trade.
    "24hHigh": "1900.50", // Highest price in the last 24 hours.
    "24hLow": "1820.75", // Lowest price in the last 24 hours.
    "24hVolume": "15000000.1234", // Trading volume in the base asset over the last 24 hours.
    "24hChangePercent": "2.5" // Percentage change in price over the last 24 hours.
  },
  "timestamp": 1637276970123 // Unix timestamp (milliseconds) of the update.
}
```

#### Orderbook Channel

Provides real-time order book snapshots (bids and asks) for a specified trading pair and chain, up to a certain depth.

**Subscription:**

To subscribe, send a message with `type: "subscribe"` and `channel: "orderbook"`.

```json
{
  "type": "subscribe",
  "channel": "orderbook",
  "params": {
    "pair": "ETH-USDC", // Trading pair (BASE-QUOTE). Required.
    "chainId": 1, // Blockchain network ID. Required.
    "depth": 50 // Number of price levels to include for bids and asks (e.g., 10, 50, 100). Optional, defaults to 20.
  }
}
```

**Data Message:**

Once subscribed, you will receive messages with `type: "data"` containing the current order book state.

```json
{
  "type": "data",
  "channel": "orderbook",
  "data": {
    "pair": "ETH-USDC", // The trading pair for this update.
    "chainId": 1, // The chain ID for this pair.
    "bids": [ // Array of bid levels, sorted highest price first. Each level is [price, quantity].
      ["1850.25", "10.5"], // Price level (string), Total quantity at this price level (string).
      ["1850.00", "15.2"]
      // ... up to 'depth' levels
    ],
    "asks": [ // Array of ask levels, sorted lowest price first. Each level is [price, quantity].
      ["1850.50", "8.7"],
      ["1851.00", "12.3"]
      // ... up to 'depth' levels
    ],
    "sequence": 123456 // Sequence number for managing updates. Increments with each change.
  },
  "timestamp": 1637276970123 // Unix timestamp (milliseconds) of the snapshot.
}
```

#### Trades Channel

Streams real-time trade execution information.

**Subscription:**
```json
{
  "type": "subscribe",
  "channel": "trades",
  "params": {
    "pairs": ["ETH-USDC", "WBTC-USDC"],
    "chainId": 1
  }
}
```

**Data Message:**
```json
{
  "type": "data",
  "channel": "trades",
  "data": {
    "pair": "ETH-USDC",
    "chainId": 1,
    "price": "1850.25",
    "amount": "5.2",
    "side": "buy",
    "transactionHash": "0x1234...",
    "id": "T123456"
  },
  "timestamp": 1637276970123
}
```

### User-Specific Channels

#### Order Updates Channel

Provides real-time updates on user orders.

**Subscription:**
```json
{
  "type": "subscribe",
  "channel": "orders",
  "params": {
    "chainIds": [1, 137]
  }
}
```

**Data Message:**
```json
{
  "type": "data",
  "channel": "orders",
  "data": {
    "orderId": "0x1234...",
    "status": "filled",
    "chainId": 1,
    "sellToken": "0x1234...",
    "buyToken": "0xabcd...",
    "sellAmount": "1000000000000000000",
    "buyAmount": "50000000000000000",
    "filledSellAmount": "1000000000000000000",
    "filledBuyAmount": "50000000000000000",
    "transactionHash": "0x..."
  },
  "timestamp": 1637276970123
}
```

#### Balance Updates Channel

Streams real-time balance changes.

**Subscription:**
```json
{
  "type": "subscribe",
  "channel": "balances",
  "params": {
    "address": "0x5678...",
    "chainIds": [1, 137]
  }
}
```

**Data Message:**
```json
{
  "type": "data",
  "channel": "balances",
  "data": {
    "address": "0x5678...",
    "token": "0x1234...",
    "symbol": "ETH",
    "chainId": 1,
    "balance": "5000000000000000000",
    "previousBalance": "6000000000000000000",
    "transactionHash": "0x..."
  },
  "timestamp": 1637276970123
}
```

#### Cross-Chain Transaction Updates

Tracks the progress of cross-chain transactions.

**Subscription:**
```json
{
  "type": "subscribe",
  "channel": "crossChainTx",
  "params": {
    "transactionIds": ["0x1234..."]
  }
}
```

**Data Message:**
```json
{
  "type": "data",
  "channel": "crossChainTx",
  "data": {
    "id": "0x1234...",
    "status": "destinationConfirmed",
    "sourceChainId": 1,
    "destinationChainId": 137,
    "sourceTransactionHash": "0x...",
    "destinationTransactionHash": "0x...",
    "progress": 0.9, // 0 to 1 scale
    "currentStep": "destination_execution",
    "estimatedTimeRemaining": 60 // seconds
  },
  "timestamp": 1637276970123
}
```

## Error Handling

Error messages follow a consistent format:

```json
{
  "type": "error",
  "code": "SUBSCRIPTION_FAILED",
  "message": "Failed to subscribe to the requested channel",
  "data": {
    "channel": "orders",
    "reason": "Invalid parameters"
  },
  "timestamp": 1637276970123
}
```

Common error codes:

| Code | Description |
|------|-------------|
| AUTHENTICATION_FAILED | Invalid API key or signature |
| SUBSCRIPTION_FAILED | Unable to subscribe to channel |
| INVALID_REQUEST | Malformed request |
| RATE_LIMITED | Too many requests |
| INTERNAL_ERROR | Server encountered an error |
| CONNECTION_LIMIT_EXCEEDED | Too many connections from same client |

## Heartbeat

The server sends periodic ping messages to maintain the connection:

```json
{
  "type": "ping",
  "timestamp": 1637276970123
}
```

Clients should respond with a pong message:

```json
{
  "type": "pong",
  "timestamp": 1637276970123
}
```

If no pong is received after 30 seconds, the connection will be closed.

## Connection Limits & Best Practices

- Maximum 5 concurrent WebSocket connections per API key
- Reconnect with exponential backoff after disconnection
- Only subscribe to channels you need
- Batch multiple subscriptions into a single request when possible
- Maintain heartbeat responses to keep the connection alive

## Code Example

Complete JavaScript example for connecting and subscribing:

```javascript
const WebSocket = require('ws');
const crypto = require('crypto');

// Configuration
const API_KEY = 'your_api_key';
const API_SECRET = 'your_api_secret';

// Generate signature
const timestamp = Date.now().toString();
const message = timestamp + 'GET' + '/v1';
const signature = crypto
  .createHmac('sha256', API_SECRET)
  .update(message)
  .digest('hex');

// Connect with authentication
const ws = new WebSocket(`wss://ws.aetherdex.io/v1?apiKey=${API_KEY}&timestamp=${timestamp}&signature=${signature}`);

// Handle connection open
ws.on('open', () => {
  console.log('Connected to AetherDEX WebSocket');
  
  // Subscribe to ticker channel
  ws.send(JSON.stringify({
    type: 'subscribe',
    channel: 'ticker',
    params: {
      pairs: ['ETH-USDC', 'WBTC-USDC'],
      chainId: 1
    }
  }));
});

// Handle incoming messages
ws.on('message', (data) => {
  const message = JSON.parse(data);
  
  switch (message.type) {
    case 'data':
      console.log(`Received data on ${message.channel} channel:`, message.data);
      break;
    case 'ping':
      // Respond to heartbeat
      ws.send(JSON.stringify({
        type: 'pong',
        timestamp: Date.now()
      }));
      break;
    case 'error':
      console.error('Error:', message.message);
      break;
    default:
      console.log('Received message:', message);
  }
});

// Handle errors and disconnects
ws.on('error', (error) => {
  console.error('WebSocket error:', error);
});

ws.on('close', (code, reason) => {
  console.log(`Connection closed: ${code} - ${reason}`);
  // Implement reconnection logic here
});
```

Python example using `websockets` library:

```python
import asyncio
import websockets
import json
import hmac
import hashlib
import time

API_KEY = 'your_api_key'
API_SECRET = 'your_api_secret'
WS_URL = 'wss://ws.aetherdex.io/v1' # Or sandbox URL

async def connect_aetherdex_ws():
    # --- Authentication Method 1: Query Parameters ---
    # timestamp = str(int(time.time() * 1000))
    # message = f"{timestamp}GET/v1"
    # signature = hmac.new(API_SECRET.encode('utf-8'), message.encode('utf-8'), hashlib.sha256).hexdigest()
    # auth_url = f"{WS_URL}?apiKey={API_KEY}&timestamp={timestamp}&signature={signature}"
    # async with websockets.connect(auth_url) as websocket:
    #     print("Connected using Query Params")
    #     # Proceed with subscriptions...

    # --- Authentication Method 2: Authentication Message ---
    async with websockets.connect(WS_URL) as websocket:
        print("Connected, sending authentication message...")
        timestamp = str(int(time.time() * 1000))
        message = f"{timestamp}GET/v1" # Note: Path might vary based on server implementation, confirm if needed
        signature = hmac.new(API_SECRET.encode('utf-8'), message.encode('utf-8'), hashlib.sha256).hexdigest()

        auth_payload = {
            "type": "authenticate",
            "apiKey": API_KEY,
            "timestamp": timestamp,
            "signature": signature
        }
        await websocket.send(json.dumps(auth_payload))
        auth_response = await websocket.recv()
        print(f"Authentication response: {auth_response}")
        # Check response for success before proceeding

        # Subscribe to ticker
        subscribe_payload = {
            "type": "subscribe",
            "channel": "ticker",
            "params": {
                "pairs": ["ETH-USDC", "WBTC-USDC"],
                "chainId": 1
            }
        }
        await websocket.send(json.dumps(subscribe_payload))
        print("Subscribed to ticker channel")

        # Listen for messages
        while True:
            try:
                message_str = await websocket.recv()
                message = json.loads(message_str)

                if message.get("type") == "ping":
                    pong_payload = {"type": "pong", "timestamp": str(int(time.time() * 1000))}
                    await websocket.send(json.dumps(pong_payload))
                    # print("Sent Pong")
                elif message.get("type") == "data":
                    print(f"Received data ({message.get('channel')}): {message.get('data')}")
                elif message.get("type") == "error":
                     print(f"Error: {message.get('message')} - {message.get('data')}")
                else:
                    print(f"Received other message: {message}")

            except websockets.exceptions.ConnectionClosedOK:
                print("Connection closed normally.")
                break
            except websockets.exceptions.ConnectionClosedError as e:
                print(f"Connection closed with error: {e}")
                # Implement reconnection logic here
                break
            except Exception as e:
                print(f"An error occurred: {e}")
                # Handle other errors, potentially break or attempt reconnect
                break

if __name__ == "__main__":
    asyncio.run(connect_aetherdex_ws())

```

For additional examples and implementation details, see the [SDK documentation](./sdk.md).
