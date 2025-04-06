# Trading Features

This guide explains the various trading features available on AetherDEX, including trading types, advanced order options, and cross-chain functionality.

## Trading Types

AetherDEX offers multiple trading methods to suit different needs:

### Spot Trading

Trade directly between token pairs with immediate execution.

1. **Select Trading Pair**: Choose your desired base and quote tokens
2. **Choose Order Type**: Select market or limit order
3. **Enter Amount**: Specify the amount to buy or sell
4. **Review & Execute**: Confirm details and submit the trade

### Cross-Chain Trading

Seamlessly trade assets across different blockchain networks.

1. **Select Source Chain**: Choose the blockchain where your assets currently reside
2. **Select Destination Chain**: Choose the blockchain where you want to receive assets
3. **Select Tokens**: Choose which token to trade from and to
4. **Review Route & Fees**: See the optimal path and associated costs
5. **Execute Cross-Chain Trade**: Confirm and track progress across chains

### Liquidity Pool Swaps

Trade directly with liquidity pools for better rates on certain pairs.

1. **Select Pool**: Choose from available liquidity pools
2. **Enter Swap Amount**: Specify how much to swap
3. **Review Pool Details**: See pool composition, fees, and expected slippage
4. **Execute Pool Swap**: Confirm the transaction in your wallet

## Order Types

### Market Orders

Execute immediately at the best available current price.

**Advantages**:
- Guaranteed execution
- Quick settlement
- No need to monitor price movements

**Best for**: Traders who prioritize execution certainty over exact price

### Limit Orders

Set a specific price at which you want your order to execute.

**Advantages**:
- Control over execution price
- Potential for better prices than market
- Place orders in advance

**Best for**: Traders who have a target price and are willing to wait

### Stop Orders

Trigger a market order when price reaches a specified level.

**Advantages**:
- Automated risk management
- Protect profits or limit losses
- Execute based on technical levels

**Best for**: Active traders managing position risk

### Time-Weighted Average Price (TWAP) Orders

Automatically split a large order into smaller pieces executed over time.

**Advantages**:
- Minimize price impact for large orders
- Achieve average market price
- Reduce execution risk

**Best for**: Traders with large positions or institutional needs

## Advanced Trading Features

### Gas Optimization

AetherDEX automatically optimizes gas costs for your trades.

**Features**:
- **Dynamic Gas Settings**: Adjust gas price based on network conditions
- **Gas Tokens**: Option to pay fees in gas-optimized tokens
- **Transaction Batching**: Combine multiple operations into one transaction
- **Gasless Swaps**: Option for meta-transactions with gas paid by relayers

### Price Impact Analysis

Understand and minimize slippage for your trades.

**Tools**:
- **Slippage Calculator**: Estimate price impact before trading
- **Custom Slippage Settings**: Set your tolerable slippage threshold
- **Split Route Visualization**: See how your order is routed for minimal impact
- **Market Depth Chart**: Visualize available liquidity at different price levels

### MEV Protection

AetherDEX includes features to protect your trades from MEV (Miner Extractable Value) extraction.

**Protection Mechanisms**:
- **Private Transaction Pools**: Bypass public mempool when possible
- **Slippage Guards**: Prevent sandwich attacks with strict execution parameters
- **RFQ Systems**: Access private liquidity for large orders
- **Timing Considerations**: Smart execution timing to minimize frontrunning risk

## Cross-Chain Trading

### Supported Blockchain Networks

AetherDEX currently supports trading across multiple blockchains:

- Ethereum Mainnet
- Polygon
- Arbitrum
- Optimism
- BNB Chain
- Avalanche
- Solana
- Cosmos Ecosystem
- And more...

### Cross-Chain Mechanics

Understanding the technology powering cross-chain trades:

**Bridge Technologies**:
- **Lock and Mint**: Assets locked on source chain, minted on destination
- **Burn and Release**: Tokens burned on source, released on destination
- **Atomic Swaps**: Direct trustless exchange across chains
- **Message Passing**: Smart contract communication between chains

**Confirmation Times**:
Different chains have different finality times. Cross-chain trades typically involve:

1. Transaction confirmation on source chain (varies by chain)
2. Bridge processing time (typically 2-30 minutes)
3. Transaction confirmation on destination chain (varies by chain)

### Security Considerations

Cross-chain trading involves additional security factors:

- **Bridge Security Tiers**: Different bridges have varying security models
- **Amount Limits**: Higher value transfers may require additional verification
- **Confirmation Requirements**: Some transfers require more confirmations
- **Rescue Options**: Recovery methods for stuck cross-chain transactions

## Trading Analytics

### Performance Tracking

AetherDEX provides tools to analyze your trading performance:

- **Trade History**: Comprehensive record of all transactions
- **Performance Metrics**: Calculate profit/loss across trades
- **Fee Analysis**: Visualize trading costs over time
- **Trading Patterns**: Identify personal trading trends

### Market Analytics

Market data to inform your trading decisions:

- **Price Charts**: Technical analysis with multiple timeframes
- **Liquidity Depth**: Visualize available market depth
- **Volatility Indicators**: Measure market volatility
- **Gas Price Trends**: Track network fee fluctuations

## Mobile Trading

AetherDEX offers full trading functionality on mobile devices:

- **Mobile App**: Native iOS and Android applications
- **Mobile Web**: Responsive web interface for all devices
- **Push Notifications**: Real-time alerts for trade execution
- **Biometric Security**: Face ID/Touch ID support for transaction signing

## Troubleshooting Common Issues

### Transaction Failures

Common reasons for failed transactions and how to resolve them:

1. **Insufficient Gas**: Increase gas limit or price
2. **High Slippage**: Increase slippage tolerance or reduce trade size
3. **Price Movement**: Update price quote and try again
4. **Liquidity Issues**: Try a different token pair or route

### Cross-Chain Problems

Troubleshooting cross-chain transactions:

1. **Pending Bridging**: Check bridge status page
2. **Failed Source Transaction**: Review error on source chain explorer
3. **Destination Delays**: Verify destination chain network status
4. **Bridge Downtime**: Check bridge protocol status pages

For additional help with specific trading issues, please visit our [Support Portal](https://support.aetherdex.io) or review the [FAQ](./faq.md) section.
