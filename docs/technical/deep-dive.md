# AetherDEX Technical Details

This document provides in-depth technical information about specific core components and strategies used within the AetherDEX platform, including the AetherRouter contract, interoperability mechanisms, and liquidity sourcing.

## AetherRouter Contract

*(See also [AetherRouter Contract](./router-contract.md) for more specific details on its implementation.)*

### Overview

The `AetherRouter` contract is the central smart contract acting as the primary user-facing interface for initiating DEX operations within AetherDEX, particularly for cross-chain swaps. Its responsibilities include:

- Receiving user swap requests
- Facilitating optimal route calculation (often delegated to off-chain services but validated/used on-chain)
- Executing single-chain swaps via integrated liquidity sources (e.g., 0x, Uniswap)
- Initiating and managing cross-chain swaps via integrated interoperability providers (e.g., LayerZero, CCIP)
- Handling fee collection and distribution
- Providing mechanisms for recovering failed operations where possible

### Security Features & Considerations

The `AetherRouter` incorporates several security measures:

- **Input Validation**: Rigorous checks on token addresses, amounts (non-zero, range checks), recipient addresses, chain IDs, and route data structure
- **Reentrancy Guard**: Protects functions making external calls from reentrancy attacks
- **Fee Handling**: Secure accounting, distribution mechanism, and potential refunds for excess fees paid (e.g., for cross-chain messaging)
- **Error Handling**: Uses custom errors for clarity (`InsufficientOutputAmount`, `InvalidRouteData`, etc.) and emits events for failed operations
- **State Management**: Tracks the state of operations, especially cross-chain ones, to potentially allow for recovery
- **Access Control**: Critical functions like fee distribution or parameter changes are access-controlled (e.g., `onlyOwner` or multi-sig)
- **Cross-Chain Message Verification**: Ensures authenticity and integrity of messages received from other chains
- **Slippage Protection**: Enforces `amountOutMin` parameters provided by the user
- **Gas Optimization**: Designed to minimize gas costs where possible, e.g., using view functions for calculations, minimizing storage writes

### Implementation Highlights

- **Route Execution**: Processes `routeData` which encodes the steps (e.g., swap on DEX A, bridge via Protocol B, swap on DEX C) needed to fulfill the user's request
- **Cross-Chain Messaging Integration**: Interfaces with specific functions of integrated protocols like CCIP (`ccipSend`) or LayerZero (`lzSend`) to dispatch messages and funds
- **Callback Handling**: Implements functions to receive and process messages/funds arriving from other chains to complete the second leg of a cross-chain swap
- **Event Emission**: Emits detailed events (`RouteExecuted`, `CrossChainRouteInitiated`, `OperationFailedEvent`) for off-chain monitoring and indexing

### Core API (Illustrative Solidity Signatures)

```solidity
// Get expected output and route data for a potential swap (often computed off-chain but may have on-chain views)
function getOptimalRoute(
  address tokenIn,
  address tokenOut,
  uint256 amountIn,
  uint16 targetChainId // May differ for cross-chain
) external view returns (uint256 amountOut, bytes memory routeData);

// Execute a swap based on pre-calculated route data
function executeRoute(
  address tokenIn,
  address tokenOut,
  uint256 amountIn,
  uint256 amountOutMin, // Slippage protection
  address recipient,
  bytes memory routeData
) external payable returns (uint256 amountOut); // Payable if input is native token

// Specific function for initiating cross-chain swaps
function executeCrossChainRoute(
  address tokenIn,
  address tokenOut,
  uint256 amountIn,
  uint256 amountOutMin,
  address recipient, // Final recipient on destination chain
  uint16 destinationChainId,
  bytes memory routeData, // Includes bridging instructions
  uint fee // Bridge/messaging fee
) external payable; // Payable for input token and bridge fee

// Function potentially called by owner/admin to recover stuck funds from failed ops
function recoverFailedOperation(bytes calldata operationId) external;

// Function for protocol owner/treasury to withdraw collected fees
function distributeFees() external;

// Function for users to claim refunds if they overpaid cross-chain fees
function refundExcessFee(bytes calldata operationId) external;
```

### Cross-Chain Flow Example

1. User calls `executeCrossChainRoute` on Source Chain Router
2. Router locks tokenIn (or receives native token)
3. Router uses routeData to interact with the chosen interoperability provider's contract (e.g., LayerZero endpoint, CCIP router), sending funds and message payload
4. Interoperability protocol transmits the message and value to the Destination Chain
5. A corresponding contract on the Destination Chain receives the message and funds
6. Destination contract executes the final swap (e.g., tokenBridged → tokenOut) using local liquidity sources
7. tokenOut is sent to the final recipient

### Error & Event Reference

**Common Errors:**
- `InsufficientOutputAmount`: Slippage protection triggered
- `InvalidRouteData`: Provided route cannot be parsed or executed
- `TransferFailed`: Internal token transfer failed
- `InsufficientFee`: Fee provided for cross-chain messaging is too low
- `DeadlineExpired`: Transaction not mined before specified deadline

**Common Events:**
- `RouteExecuted`: Successful single-chain or final leg execution
- `CrossChainInitiated`: Cross-chain operation started, includes identifiers
- `FeeCollected`: Fees collected for protocol/LPs
- `OperationFailedEvent`: Details of a failed operation
- `FundsRecovered`: Emitted when recovery mechanism is successfully used

## Interoperability Architecture

*(See also [Interoperability Architecture](./interoperability.md) for more specific details on provider integration.)*

### Core Design Philosophy

AetherDEX embraces a multi-provider interoperability strategy to maximize connectivity, resilience, and execution quality. It avoids vendor lock-in and leverages the strengths of different cross-chain communication protocols.

### Multi-Provider Infrastructure

AetherDEX integrates multiple interoperability solutions via its Provider Abstraction Layer (PAL). This allows:

- **Simultaneous Connections**: Can route transactions through different providers concurrently or based on optimal choice
- **Fallback Mechanisms**: Automatically reroutes through alternative providers if the primary choice fails or is congested
- **Optimized Routing**: Selects the best provider based on cost, speed, security, and specific transaction needs

### Supported & Planned Interoperability Providers

| Provider | Type | Key Features | Status | Notes |
|----------|------|-------------|--------|-------|
| LayerZero | Messaging Protocol | Omnichain, ULNs, configurable security | Active | Good for general message passing |
| Chainlink CCIP | Messaging & Token | High security, programmable tokens | Active | Strong security assumptions via DONs |
| Hyperlane | Messaging Protocol | Modular security, fast finality | Active | Permissionless deployment |
| Axelar | Messaging Network | GMP, large ecosystem | Planned | Hub-and-spoke model |
| Wormhole | Messaging & Bridge | High connectivity, guardian network | Planned | Connects many distinct ecosystems |
| Other Bridges | Token Bridging | e.g., Native bridges, Synapse, Hop | Potential | Used for direct token transfers when optimal |

### Provider Selection Algorithm

The PAL incorporates a dynamic selection algorithm considering factors like:

- **Quoted Fees**: Gas costs on source/destination + provider-specific fees
- **Estimated Speed**: Historical and real-time data on finality times
- **Security Profile**: Configurable risk tolerance vs. provider's security model
- **Reliability**: Provider uptime and success rates
- **Liquidity Path**: Availability of specific tokens/routes via the provider
- **Transaction Value**: Higher value transactions might default to higher security providers

### Fail-Safe and Recovery Mechanisms

- **Automatic Fallback**: If `providerA.send()` fails, try `providerB.send()`
- **Transaction Monitoring**: Off-chain services track cross-chain messages across providers
- **Recovery Functions**: AetherRouter includes functions that might allow admin/user intervention for specific failure scenarios
- **Timeouts & Alerts**: Monitoring for transactions exceeding expected duration triggers alerts

### Integration Architecture (Conceptual Adapter)

The PAL uses standardized interfaces for different providers:

```javascript
// Simplified conceptual interface in the backend/PAL
interface InteropProviderAdapter {
  providerId: string;
  getQuote(params: CrossChainQuoteParams): Promise<InteropQuote>;
  initiateTx(params: CrossChainTxParams): Promise<TxInitiationResult>;
  getTxStatus(txId: string): Promise<InteropTxStatus>;
  // Potentially methods for recovery or message retrieval
}

// Example Usage in Routing Logic:
async function findBestInteropRoute(params) {
  const quotes = await Promise.all(
  activeProviders.map(p => p.getQuote(params))
  );
  const bestQuote = selectBestQuote(quotes); // Based on cost, speed, etc.
  const result = await bestQuote.provider.initiateTx(params, bestQuote.details);
  return result;
}
```

This modular approach allows adding or removing providers with minimal disruption to the core logic.

### Cross-Chain Liquidity Synchronization (`CrossChainLiquidityHook.sol`)

Separate from the main swap routing, AetherDEX utilizes a dedicated hook (`backend/smart-contract/src/hooks/CrossChainLiquidityHook.sol`) to synchronize liquidity provision changes across different chains. This aims to provide a more unified view of liquidity depth for specific pools across the supported networks.

**Mechanism:**

1.  **Hook Attachment**: The `CrossChainLiquidityHook` is attached to AetherPools via the `PoolManager`.
2.  **Trigger**: It activates on the `afterModifyPosition` hook whenever a user adds or removes liquidity (`liquidityDelta != 0`).
3.  **Messaging Provider**: It specifically uses LayerZero (`ILayerZeroEndpoint`) for its cross-chain communication.
4.  **Message Broadcasting**: When liquidity changes on one chain, the hook encodes the pool details (`token0`, `token1`) and the `liquidityDelta` (positive for adds, negative for removes). It then sends this payload via LayerZero to the registered `remoteHooks` (instances of `CrossChainLiquidityHook` on other supported chains).
5.  **Receiving Updates**: The `lzReceive` function on the destination chain's hook receives the message, verifies it came from a registered remote hook, decodes the payload, and emits a `CrossChainLiquidityEvent`.
6.  **Purpose**: This mechanism allows off-chain components or potentially other contracts to observe liquidity changes across the ecosystem, facilitating better routing decisions or analytics, even if the liquidity itself isn't directly bridged. It does *not* move the actual liquidity tokens between chains.
7.  **Configuration**: The mapping of chain IDs to remote hook addresses is managed by the `poolManager` via the `setRemoteHook` function. Fee estimation for LayerZero messages is available via `estimateFees`.

## Liquidity Sources and Aggregation

### Multi-Source Liquidity Strategy

AetherDEX aims to provide the best possible execution price by aggregating liquidity from multiple sources across different chains. The strategy ensures:

- **Best Price Execution**: Accessing deep liquidity minimizes price impact
- **Low Slippage**: Reduced price movement during trade execution
- **High Reliability**: Increased chance of successful trade execution even for large orders or obscure pairs
- **Wide Token Access**: Supports trading of a vast range of tokens available across integrated sources

### Primary Liquidity Aggregator: 0x Protocol

0x Protocol is a key integration for sourcing on-chain liquidity.

**Key Benefits Provided by 0x:**
- **Broad DEX Access**: Aggregates liquidity from Uniswap (v2, v3), SushiSwap, Curve, Balancer, and many other DEXs across multiple chains
- **Smart Order Routing**: Sophisticated algorithms find the most efficient path, potentially splitting trades across multiple pools
- **RFQ System**: Supports Request-for-Quote (RFQ) for potentially better pricing from professional market makers, especially for larger trades
- **Gas Efficiency**: Optimized contracts and routing minimize transaction costs
- **Reliable API**: Provides robust endpoints for price discovery (`/swap/v1/quote`) and transaction data (`/swap/v1/price`)

**Integration Details:**
- AetherDEX's backend/router queries the 0x API to get quotes and executable transaction data
- The AetherRouter contract might directly call the 0x exchange proxy contract (ZeroExProxy) or use data provided by the API to interact with underlying DEXs

Example (Conceptual Backend Quote Fetch):

```javascript
import axios from 'axios';

const ZEROEX_API_URL = 'https://api.0x.org'; // Or chain-specific endpoint

async function get0xQuote(params: {
  sellToken: string;
  buyToken: string;
  sellAmount?: string;
  buyAmount?: string;
  // ... other params like slippagePercentage, includedSources, etc.
}) {
  try {
  const response = await axios.get(`${ZEROEX_API_URL}/swap/v1/quote`, { params });
  // Returns price, gas estimate, route details, calldata for tx, etc.
  return response.data;
  } catch (error) {
  console.error("Error fetching 0x quote:", error.response?.data || error.message);
  throw error;
  }
}
```

### Other Integrated Liquidity Sources

AetherDEX may integrate other aggregators or sources directly:

- **1inch Aggregator**: Known for its Pathfinder algorithm finding complex routes
- **ParaSwap**: Offers multi-path routing and potentially MEV protection features
- **Direct DEX Integration**: May interact directly with major DEX routers (e.g., Uniswap Universal Router)
- **Native AetherDEX Pools**: Liquidity pools hosted directly by AetherDEX smart contracts, potentially incentivized
- **Market Makers**: Off-chain liquidity via RFQ systems

### Dynamic Source Selection & Routing

The Liquidity Engine / Core Trading logic performs dynamic selection:

1. **Query Multiple Sources**: Fetches quotes from 0x, potentially 1inch, ParaSwap, and any direct integrations concurrently
2. **Compare Quotes**: Evaluates quotes based on net output amount after accounting for gas fees and any protocol fees
3. **Select Optimal Route**: Chooses the source(s) providing the best execution
4. **Generate Transaction**: Constructs the final transaction data to execute the swap via the selected route(s)

### Fallback and Reliability

- **Redundancy**: If one API is down, the system automatically relies on other integrated aggregators
- **Quote Validation**: Quotes are checked for validity and competitiveness before execution
- **Circuit Breakers**: Mechanisms to prevent executing trades if the price significantly deviates from market rates

### Future Expansion

The architecture allows for continuous integration of new liquidity sources:

- Other aggregators (e.g., KyberSwap)
- Order book DEXs
- Specialized protocols (e.g., CoW Protocol for gasless trades/MEV protection)
- Cross-chain liquidity networks providing native asset swaps without bridging

## Dynamic Fee Mechanism (FeeRegistry.sol)

AetherDEX employs a dynamic fee structure for certain token pairs, managed by the `FeeRegistry` contract. This allows fees to adjust based on recent trading activity, aiming to balance incentives for liquidity providers and competitiveness for traders.

### Fee Configuration

- **Owner Controlled**: The contract owner sets the fee parameters for each token pair (`token0`, `token1`).
- **Parameters**:
    - `minFee`: The minimum fee percentage (basis points, e.g., 5 = 0.05%).
    - `maxFee`: The maximum fee percentage (basis points, e.g., 100 = 1.0%). Capped globally at 1000 (1.0%).
    - `adjustmentRate`: A rate determining how sensitive the fee is to recent swap volume.

### Fee Calculation

The current fee for a pair is calculated based on its configuration and the net `swapVolume` recorded for that pair:

1.  **Net Volume Tracking**: The `FeeRegistry` tracks the net signed volume (`swapVolume`) for each pair. When `token0` is sold for `token1`, `swapAmount` is positive; when `token1` is sold for `token0`, `swapAmount` is negative.
2.  **Fee Adjustment**: An adjustment is calculated: `feeAdjustment = (swapVolume * adjustmentRate) / 1e18`. This adjustment can be positive or negative.
3.  **Base Fee**: The adjusted fee is added to the `minFee`: `calculatedFee = minFee + feeAdjustment`.
4.  **Clamping**: The final fee is clamped between `minFee` and `maxFee`: `finalFee = max(minFee, min(maxFee, calculatedFee))`.

### Fee Updates

- The `updateFee` function is called (likely via a hook like `DynamicFeeHook.sol`) after a swap occurs.
- It updates the `swapVolume` for the pair by adding the signed `swapAmount` from the recent trade.
- The `lastUpdated` timestamp is recorded.

This mechanism allows fees to increase slightly when there's high demand for swapping in one direction (positive `swapVolume`) and decrease when the flow reverses (negative `swapVolume`), always staying within the configured bounds. (Implemented in `backend/smart-contract/src/FeeRegistry.sol`).

## On-Chain TWAP Oracle (`TWAPOracleHook.sol`)

AetherDEX utilizes an on-chain Time-Weighted Average Price (TWAP) oracle implemented as a pool hook (`backend/smart-contract/src/hooks/TWAPOracleHook.sol`). This hook provides a manipulation-resistant price feed derived directly from swap activities within AetherPools.

### Functionality

- **Hook Integration**: Attaches to AetherPools via the `PoolManager` and implements `afterSwap` (and other) hook permissions.
- **Observation Recording**: After each swap in an attached pool, the hook calculates the marginal price based on the `BalanceDelta` (change in token balances). This price and the block timestamp are stored as an `Observation`.
    - **Scaling**: Price calculations use reduced scaling factors (`SCALE=1000`, `AMOUNT_SCALE=1e15`) for gas efficiency and to fit within `uint64`.
- **Observation Window**: Stores observations for a configurable `windowSize` (default 3600 seconds). Older observations are automatically pruned.
- **Price Consultation**: The `consult` function allows external contracts or users to query the recorded price observation nearest to a specified time (`secondsAgo`) within the observation window.
    - **Time Bounds**: Queries must be for a period between `MIN_PERIOD` (60 seconds) and `windowSize`.
    - **Token Order**: Handles price representation consistently regardless of `token0`/`token1` order.
- **Initialization**: Can be initialized with a starting price using `initializeOracle`.

### Use Cases

- **Manipulation Resistance**: Provides a price feed less susceptible to short-term manipulation (e.g., flash loan attacks) compared to spot prices, as it relies on historical observations.
- **On-Chain Price Data**: Offers a decentralized price source available directly within the smart contract ecosystem, useful for other DeFi protocols integrating with AetherDEX pools.
- **Potential Fee Calculations**: Could potentially be used as an input for other dynamic mechanisms (though the current `FeeRegistry` uses volume).

### Limitations

- **Lag**: TWAP prices inherently lag behind the real-time spot price.
- **Liquidity Dependence**: Accuracy depends on sufficient swap activity within the pool. Low-volume pools may have stale or less reliable TWAP data.
- **Window Size Trade-off**: A longer `windowSize` provides more manipulation resistance but increases lag. A shorter window is more responsive but potentially less secure.
- **Gas Cost**: Recording observations adds a small gas overhead to swaps in hooked pools.

## Direct Smart Contract Interaction

While the SDKs and APIs provide convenient abstractions, developers can also interact directly with the AetherDEX smart contracts, primarily the `AetherRouter`, for maximum control and integration into other on-chain protocols.

### Typical Flow (Single-Chain Swap)

1.  **Get Quote Data**: Obtain swap parameters (`to`, `data`, `value`, `allowanceTarget`) from the `/v1/quote` REST API endpoint (or potentially an SDK function that wraps this). This data encodes the optimal route found by the off-chain routing engine.
2.  **Check/Set Allowance (if applicable)**: If the `sellToken` is an ERC20 token, ensure the `AetherRouter` (or the specific `allowanceTarget` returned by the API, often the 0x Proxy) has sufficient allowance to spend the `sellAmount`. If not, prompt the user to send an `approve` transaction to the `sellToken` contract.
    ```solidity
    // Example using IERC20
    IERC20 sellTokenContract = IERC20(sellTokenAddress);
    uint256 currentAllowance = sellTokenContract.allowance(userAddress, allowanceTarget);
    if (currentAllowance < sellAmount) {
        // Send approve transaction
        sellTokenContract.approve(allowanceTarget, sellAmountOrMax);
    }
    ```
3.  **Execute Swap**: Call the appropriate function on the `AetherRouter` contract. For swaps using data from the 0x-integrated quote endpoint, this often involves calling the `allowanceTarget` directly with the provided `data` and `value`. *Alternatively, if AetherRouter has its own execution functions that take route data, use those.*
    ```solidity
    // Example calling a target contract (like 0x Proxy) using API data
    (bool success, bytes memory result) = quote.allowanceTarget.call{value: quote.value}(quote.data);
    require(success, "Swap execution failed");
    // Process result if needed
    ```
    *Or, if using a dedicated AetherRouter function:*
    ```solidity
    // Conceptual - Assuming AetherRouter has an execute function taking API data
    // IAetherRouter router = IAetherRouter(routerAddress);
    // router.executeSwapFromQuote{value: quote.value}(quote.sellToken, quote.buyToken, quote.sellAmount, quote.minBuyAmount, quote.data);
    ```

### Typical Flow (Cross-Chain Swap)

1.  **Get Cross-Chain Quote Data**: Obtain parameters (`to`, `data`, `value`, `approvalData`) from the `/v1/cross-chain/quote` REST API endpoint.
2.  **Check/Set Allowance (if applicable)**: Similar to single-chain, check and set allowance for the `sellToken` on the source chain, using the `approvalData.allowanceTarget` and `approvalData.minimumApprovalAmount` from the quote response.
3.  **Execute Cross-Chain Transaction**: Call the target contract (`transactionRequest.to`, likely the `AetherRouter` on the source chain) with the provided `transactionRequest.data` and `transactionRequest.value`.
    ```solidity
    // Example calling the AetherRouter for cross-chain
    (bool success, bytes memory result) = quote.transactionRequest.to.call{value: quote.transactionRequest.value}(quote.transactionRequest.data);
    require(success, "Cross-chain initiation failed");
    // Transaction hash can be monitored off-chain using API/explorers
    ```

**Important Considerations:**

-   **Gas Fees**: Ensure the user's wallet has sufficient native currency on the source chain to cover the gas costs (`estimatedGas` * `gasPrice`) plus any `value` required (e.g., when selling native currency or paying bridge fees).
-   **Quote Validity**: Quotes expire quickly (`validTo` timestamp). Ensure the transaction is submitted before expiration.
-   **Slippage**: The `minBuyAmount` (or equivalent parameter derived from `slippagePercentage`) should be used in contract calls where possible to protect against unfavorable price movement.
-   **Error Handling**: Implement robust error handling for failed transactions (e.g., insufficient allowance, expired quote, reverted contract call).
-   **Contract Addresses**: Use reliable sources (e.g., official documentation, API responses) to get the correct `AetherRouter` and token contract addresses for the target chain.
