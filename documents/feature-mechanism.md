## Feature Mechanisms

This document outlines the implementation guidelines and testing considerations for various key mechanisms of the AetherDEX project, ensuring consistency between backend (smart contracts) and frontend implementations.

### Fee Collection Mechanism

AetherDEX smart contracts implement a fee collection mechanism to monetize the DEX and incentivize liquidity providers. 

-   **Swap Fees:** A 0.3% fee is applied to all token swaps on the DEX. This fee is automatically accumulated within the liquidity pool contracts.
-   **Fee Accumulation:** Swap fees are directly deposited into the reserves of the liquidity pool in which the swap occurs. This increases the value of the liquidity pool tokens over time.
-   **Fee Collection by Liquidity Providers:** Liquidity providers earn a portion of these swap fees proportional to their share of the liquidity pool. They can realize these earnings by "burning" (redeeming) their LP tokens, which withdraws their proportional share of the underlying tokens, including the accumulated fees.
-   **Fee Collection by Owner/Admin:** The AetherFactory contract (or a designated admin address) will be able to collect protocol fees, a small portion of the swap fees, from the liquidity pools. This will be implemented via a `collectFees` function in the `AetherFactory.sol` contract, callable only by the contract owner, allowing withdrawal of accumulated fees to a designated address. 
-   **Future Fee Distribution (Phase 2 & 3):** In future phases, a governance mechanism may be introduced to manage and distribute protocol fees, potentially to a DAO treasury or for other community-driven initiatives.

### Upgradable Smart Contracts Mechanism

AetherDEX smart contracts are designed to be upgradable to allow for future feature additions, bug fixes, and protocol improvements without requiring users to migrate to new contracts.

-   **Backend Implementation (Smart Contracts):**
    -   **Proxy Pattern:** Implement the smart contracts using the Proxy pattern (e.g., using OpenZeppelin's `UUPSUpgradeable` proxy). This involves deploying a proxy contract that holds the state and delegates calls to an implementation contract containing the logic.
    -   **Implementation Contract Updates:** When an upgrade is needed, a new implementation contract with updated logic is deployed. The proxy contract is then updated to point to this new implementation contract, while preserving the state.
    -   **Admin Control:**  Restrict proxy contract upgrades to a designated admin address (contract owner) to maintain security and prevent unauthorized upgrades.
-   **Frontend Implementation (Web Interface):**
    -   **Abstract Contract Addresses:** The frontend should interact with the DEX via an abstract interface (e.g., using a configuration file or environment variables) that stores the proxy contract addresses. 
    -   **Address Updates:**  When smart contracts are upgraded, only the proxy contract addresses in the frontend configuration need to be updated. The frontend code should not need to be changed as long as the interface of the proxy contract remains consistent.
-   **Testing Guidelines:**
    -   **Upgrade Functionality Tests:** Write tests to specifically verify the upgrade functionality of the proxy contracts, ensuring that the admin can successfully upgrade the implementation contract.
    -   **State Persistency Tests:**  Test that contract state (e.g., liquidity pool data, token balances) is correctly preserved across contract upgrades.
    -   **Functionality After Upgrade Tests:** After each upgrade, run all existing functionality tests to ensure that the core DEX functionalities remain operational and are not broken by the upgrade.

### Revert/Rollback Mechanism

AetherDEX smart contracts will incorporate a revert/rollback mechanism to handle critical issues or vulnerabilities that may arise after deployment. This mechanism allows for reverting to a previous stable state of the contracts.

-   **Backend Implementation (Smart Contracts):**
    -   **Pausable Contracts:** Implement pausable contracts (e.g., using OpenZeppelin's `Pausable` contract). This allows the contract owner to pause core functionalities (like swapping, adding liquidity) in case of emergencies.
    -   **Emergency Stop Function:** Implement an emergency stop function, callable only by the contract owner, that can halt critical contract operations and potentially revert to a previous known-good state. (Note: Full state rollback on blockchain is complex and may not be fully feasible. This mechanism might primarily focus on pausing operations and allowing for controlled upgrades/fixes).
    -   **State Backup (Consider for future phases):** For more advanced rollback capabilities in future phases, consider implementing state backup mechanisms, where critical contract state is periodically backed up, allowing for potential restoration in extreme cases. (Note: This adds complexity and gas costs).
-   **Frontend Implementation (Web Interface):**
    -   **Error Handling and User Feedback:** The frontend should be designed to handle potential contract pauses or emergency stops gracefully, displaying informative error messages to the user if core functionalities are temporarily disabled.
    -   **Admin Interface (Future):** For admin users, a dedicated interface could be implemented to trigger emergency stop or rollback procedures (if full rollback is implemented in the future), with appropriate security and authorization controls.
-   **Testing Guidelines:**
    -   **Pausability Tests:** Write tests to verify that the pausable functionality works as expected, and that the contract owner can successfully pause and unpause contract operations.
    -   **Emergency Stop Tests:** Test the emergency stop function to ensure it halts critical operations as intended.
    -   **State After Pause/Stop Tests:**  Test that contract state remains consistent and is not corrupted after pausing or emergency stopping the contracts.

### Circuit Breaker Mechanism

AetherDEX smart contracts will include a circuit breaker mechanism to automatically halt critical operations in case of anomalous behavior or security threats, providing an additional layer of security and risk mitigation.

-   **Backend Implementation (Smart Contracts):**
    -   **State Variables for Thresholds:** Define state variables in the smart contracts to store threshold values for triggering the circuit breaker (e.g., swap volume limits, price deviation thresholds, anomalous transaction counts).
    -   **Monitoring Logic:** Implement logic within critical functions (e.g., swap, addLiquidity) to monitor relevant metrics and compare them against the defined thresholds.
    -   **Circuit Breaker Trigger:** If any monitored metric exceeds its threshold, trigger the circuit breaker, which automatically pauses or restricts the critical function.
    -   **Admin Reset Function:** Implement a function, callable only by the contract owner, to reset (disengage) the circuit breaker after investigation and resolution of the issue.
-   **Frontend Implementation (Web Interface):**
    -   **Circuit Breaker Status Display:** The frontend could display the status of the circuit breaker (e.g., "Operational", "Circuit Breaker Engaged") to inform users if certain functionalities are restricted due to the circuit breaker.
    -   **Admin Monitoring Dashboard (Future):** For admin users, a dashboard could be implemented to monitor circuit breaker status, thresholds, and historical triggers, providing insights into potential security events.
-   **Testing Guidelines:**
    -   **Threshold Trigger Tests:** Write tests to verify that the circuit breaker correctly triggers when monitored metrics exceed defined thresholds.
    -   **Functionality Restriction Tests:** Test that critical functionalities are indeed paused or restricted when the circuit breaker is engaged.
    -   **Admin Reset Tests:** Verify that the contract owner can successfully reset the circuit breaker after it has been triggered.
    -   **False Positive Prevention Tests:** Design tests to ensure that the circuit breaker does not trigger unnecessarily under normal operating conditions (prevent false positives).

### Slippage Optimization Mechanism

AetherDEX will implement a slippage optimization mechanism to minimize the impact of price slippage on user trades, ensuring users get the best possible execution prices.

-   **Backend Implementation (Smart Contracts):**
    -   **0x API Integration:** Integrate with the 0x API for swap routing and execution. The 0x API automatically finds the best swap routes across multiple DEXs and optimizes for slippage and gas costs. (Note: Direct Uniswap V3 integration could also be considered, but 0x API provides broader aggregation).
    -   **Slippage Parameter:** Allow users to specify a maximum slippage tolerance in their swap transactions. The smart contracts should revert the transaction if the actual slippage exceeds this tolerance.
-   **Frontend Implementation (Web Interface):**
    -   **Slippage Tolerance Setting:** Implement a UI element (e.g., a slider or input field) that allows users to set their slippage tolerance as a percentage.
    -   **Slippage Display:** Display estimated slippage for each trade before the user confirms the transaction, providing transparency and allowing users to make informed decisions.
    -   **0x API Integration (Frontend):** Integrate with the 0x API in the frontend to fetch swap quotes and parameters, leveraging its slippage optimization capabilities.
-   **Testing Guidelines:**
    -   **Slippage Limit Tests:** Write tests to verify that swaps correctly revert if the slippage exceeds the user-defined tolerance.
    -   **Slippage Optimization Tests:**  Test different swap scenarios with varying liquidity and trade sizes to ensure that the 0x API integration (or alternative routing mechanism) effectively minimizes slippage compared to direct swaps on a single DEX.
    -   **Quote Accuracy Tests:** Verify that the frontend accurately displays slippage estimates based on 0x API quotes.

### Smart Routing Mechanism

AetherDEX will implement a smart routing mechanism to enable multi-chain交易 routing, allowing users to swap tokens across different blockchain networks seamlessly. (Note: Multi-chain swaps are a Phase 2/3 feature, basic routing within Polygon zkEVM will be part of MVP).

-   **Backend Implementation (Smart Contracts & Backend Web Services):**
    -   **0x API for Routing:** Leverage the 0x API not just for slippage optimization but also for smart order routing across multiple DEXs and potentially multiple chains in the future. The 0x API abstracts away the complexity of finding the best routes.
    -   **Router Contract:** Implement a router smart contract (`AetherRouter.sol`) that interacts with the 0x API (via backend web services) to execute swaps, handling the routing logic and cross-chain communication when needed (for future phases).
    -   **Backend API for Quotes:** Develop backend web services (using Hono and Cloudflare Workers) to fetch swap quotes from the 0x API based on user input (tokens, amounts, chains).
-   **Frontend Implementation (Web Interface):**
    -   **Route Selection (Basic MVP):** For the MVP, the frontend might initially only allow swaps within Polygon zkEVM. In this case, the routing might be simplified or handled directly by the 0x API integration.
    -   **Multi-Chain Route Display (Future):** In future phases, the frontend UI will be updated to display multi-chain swap routes to the user, showing the different chains and DEXs involved in the routing process.
    -   **0x API Integration (Frontend):** Integrate with the 0x API in the frontend to send swap requests and display route information to the user.
-   **Testing Guidelines:**
    -   **Optimal Route Tests:** Write tests to verify that the smart routing mechanism (via 0x API) finds the optimal swap routes in terms of price and gas costs, compared to direct swaps.
    -   **Multi-Hop Swap Tests:** Test multi-hop swaps (swaps involving multiple DEXs or intermediate tokens in the route) to ensure they are executed correctly.
    -   **Cross-Chain Swap Simulation (Future):** For future phases with cross-chain swaps, simulate and test cross-chain routing scenarios to ensure assets are correctly bridged and swapped across chains.

### Limit Order Mechanism

AetherDEX will implement a limit order mechanism to allow users to place limit orders that are executed when the market price reaches their specified price, providing more advanced trading options beyond basic swaps.

-   **Backend Implementation (Smart Contracts & Backend Web Services):**
    -   **Off-Chain Order Book (Cloudflare KV/D1):** Implement an off-chain order book using Cloudflare KV or D1 to store limit orders. This is more gas-efficient than storing limit orders directly on-chain.
    -   **Order Matching Service (Cloudflare Workers):** Develop a backend service using Cloudflare Workers to monitor market prices and match limit orders from the off-chain order book when the price conditions are met.
    -   **Order Execution via Router Contract:** Once a match is found, the backend service will trigger order execution via the `AetherRouter.sol` smart contract to perform the swap at the limit price.
    -   **Order Cancellation:** Implement functions for users to cancel their limit orders, both on the frontend and in the backend order book.
-   **Frontend Implementation (Web Interface):**
    -   **Limit Order UI:** Implement UI elements for users to place limit orders, specifying the desired token pair, amount, and limit price.
    -   **Order Book Display:** Display a real-time order book on the frontend, showing existing limit orders for different token pairs.
    -   **Order Management:** Implement UI features for users to view and manage their active limit orders (view status, cancel orders).
-   **Testing Guidelines:**
    -   **Order Placement and Cancellation Tests:** Write tests to verify that users can successfully place and cancel limit orders via the frontend and backend.
    -   **Order Matching Tests:** Test the order matching service to ensure it correctly matches limit orders when market prices reach the limit price.
    -   **Order Execution Tests:** Verify that limit orders are executed correctly via the `AetherRouter.sol` contract when a match is found, and that swaps are performed at the specified limit price.
    -   **Concurrency and Scalability Tests:** Test the order book and matching service under high load and concurrent order placements/cancellations to ensure scalability and reliability.

### Liquidity Pool Mechanism

AetherDEX will utilize liquidity pools to enable decentralized token swaps. Users can provide liquidity to these pools and earn fees from swaps.

-   **Backend Implementation (Smart Contracts):**
    -   **Pool Contract (`AetherPool.sol`):** Implement a liquidity pool smart contract based on the Uniswap V3's concentrated liquidity model for capital efficiency. This contract will manage token reserves, handle swaps, calculate fees, and allow liquidity providers to add/remove liquidity.
    -   **Factory Contract (`AetherFactory.sol`):** Implement a factory contract to deploy and manage multiple liquidity pool contracts for different token pairs.
    -   **Liquidity Provider Functions:** Implement functions in the `AetherPool.sol` contract for liquidity providers to:
        -   **Add Liquidity:** Deposit tokens into the pool to provide liquidity and receive LP tokens representing their share.
        -   **Remove Liquidity:** "Burn" LP tokens to withdraw their proportional share of the underlying tokens and accumulated fees from the pool.
-   **Frontend Implementation (Web Interface):**
    -   **Liquidity Pool UI:** Implement UI sections for users to:
        -   **View Pools:** Browse existing liquidity pools, view pool reserves, TVL, and APR.
        -   **Add Liquidity:** Provide liquidity to a selected pool by depositing tokens and specifying a price range for concentrated liquidity.
        -   **Remove Liquidity:** Remove liquidity from a pool by "burning" LP tokens and withdrawing their share of tokens and fees.
        -   **Manage Positions:** View and manage their active liquidity positions.
-   **Testing Guidelines:**
    -   **Add/Remove Liquidity Tests:** Write tests to verify that users can successfully add and remove liquidity to pools, and that LP tokens are correctly minted and burned.
    -   **Swap Functionality Tests:** Test swap functionality within the liquidity pools to ensure swaps are executed correctly and fees are calculated and accumulated as expected.
    -   **Fee Distribution Tests:** Verify that liquidity providers correctly earn and can withdraw their proportional share of swap fees by burning LP tokens.
    -   **Concentrated Liquidity Tests:** Test the concentrated liquidity feature (if implemented for MVP or later phase) to ensure capital efficiency and correct fee accrual within specified price ranges.
