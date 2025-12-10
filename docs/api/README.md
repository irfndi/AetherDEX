# API Reference

This section provides comprehensive documentation for integrating with AetherDEX programmatically. Our API offerings include REST endpoints, WebSocket streams, and client SDKs designed for developers building on top of AetherDEX.

## Overview

AetherDEX offers multiple integration options to accommodate different use cases:

1. **REST API**: HTTP-based endpoints for querying data and executing trades
2. **WebSocket API**: Real-time data streams for market data and order updates
3. **SDK Libraries**: Client libraries for simplified integration in popular languages

## Authentication

All API access requires authentication. AetherDEX uses API keys and JWT tokens for REST and WebSocket APIs:

1. **API Key Creation**: Generate keys in the developer portal
2. **Authentication Methods**:
   - REST: API key + signature in headers
   - WebSocket: JWT authentication during connection initialization
3. **Permission Scopes**: Granular access control for different API functionalities

## Rate Limiting

To ensure service quality, rate limits apply to all API endpoints:

- Default limit: 10 requests per second
- WebSocket connections: 5 concurrent connections per API key
- Enhanced limits available for verified partners

## Available Documentation

- [REST API](./rest.md) - HTTP endpoint documentation
- [WebSocket API](./websocket.md) - Real-time data stream documentation
- [SDK Integration](./sdk.md) - Client library implementation guides

## Quick Start

The fastest way to get started with AetherDEX APIs:

```javascript
// Install the SDK
bun add @aetherdex/sdk

// Initialize the client
import { AetherDEXClient } from '@aetherdex/sdk';

const client = new AetherDEXClient({
  apiKey: 'YOUR_API_KEY',
  apiSecret: 'YOUR_API_SECRET',
  environment: 'production' // or 'staging' for testnet
});

// Get a price quote
const quote = await client.getQuote({
  sellToken: '0x1234...', // Token address to sell
  buyToken: '0xabcd...', // Token address to buy
  sellAmount: '1000000000000000000', // Amount in wei (1 ETH)
  chainId: 1 // Ethereum mainnet
});

console.log(`Expected output: ${quote.buyAmount}`);
```

## API Versioning

AetherDEX uses semantic versioning for our APIs:

- All endpoints include version prefix (e.g., `/v1/quotes`)
- Breaking changes trigger a major version increment
- Deprecated versions receive 6-month support after new version release

## Support

If you encounter issues with our API:

- Check the [API troubleshooting guide](https://docs.aetherdex.io/api/troubleshooting)
- Join the [developer Discord](https://discord.gg/aetherdex-dev)
- Email [api-support@aetherdex.io](mailto:api-support@aetherdex.io)

For additional integration examples, see our [GitHub repository](https://github.com/AetherDEX/api-examples).
