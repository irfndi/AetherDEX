# AetherDEX Web Interface

This document outlines the architecture, roadmap, and technology stack for the AetherDEX web interface.

## Overview

The AetherDEX web interface is built using Next.js and TypeScript to provide a user-friendly platform for interacting with the decentralized exchange. It focuses on providing a seamless experience for users to connect their wallets, swap tokens, and manage their portfolio.

## Architecture

The frontend interacts with the AetherDEX smart contracts and backend services to facilitate trading and data display.

### Data Flow

1.  **User Connects Wallet:** The user connects their wallet to the frontend using Web3Modal.
2.  **User Initiates Swap:** The user selects the tokens they want to swap and the amount.
3.  **Frontend Sends Request:** The frontend sends a request to the smart contract to execute the swap.
4.  **Smart Contract Executes Swap:** The smart contract executes the swap and updates the balances.
5.  **Frontend Updates Balances:** The frontend updates the user's balances and displays the new information.

## Roadmap

### Phase 1: Basic Swap Functionality (2-4 weeks)

1.  **Frontend Setup**: Create a basic Next.js application. Set up a simple UI with input fields for token selection and amounts.
2.  **Wallet Connection**: Integrate Web3Modal or wagmi to allow users to connect their wallets.
3.  **Token Balances**: Fetch and display user token balances for common ERC-20 tokens.
4.  **Swap Functionality**: Integrate with 0x API or Uniswap smart contracts for basic token swaps with basic error handling.

### Phase 2: UI Enhancements (1-2 weeks)

1.  **Improved Token Selection**: Implement a searchable dropdown or list for token selection.
2.  **Visual Refinements**: Refine the UI with better styling and layout.
3.  **Transaction History**: Display a basic transaction history for the connected wallet.

### Phase 3: Advanced Features (2-4 weeks)

1.  **Liquidity Pools**: Add functionality to view liquidity pools (if integrating directly with a specific DEX).
2.  **Slippage Control**: Allow users to set custom slippage tolerance.
3.  **Gas Optimization**: Implement gas estimation and optimization techniques.

## Network Selection and Balance Handling

When a user interacts with the AetherDEX web interface, network selection and balance handling are crucial aspects of the user experience.

### Network Selection

-   **User Interface:** The frontend will provide a network selection dropdown, allowing users to choose the blockchain network they want to use (e.g., Polygon zkEVM). Polygon zkEVM will be the default network.
-   **RPC Provider:** Upon network selection, the frontend will use an RPC URL (provided by Alchemy or another RPC provider) specific to the chosen network to communicate with the blockchain. 
-   **Configuration:** Network configurations, including RPC URLs and chain IDs, will be managed in the frontend configuration to easily support adding more networks in the future.

### Balance Handling

-   **On-Chain Balance Retrieval:** When a user selects a network and tokens for swapping, the frontend will use the connected Web3 wallet and the RPC provider to query the blockchain for the user's balances of the selected tokens on the chosen network.
-   **Web3 Library (ethers.js v6):**  The balance retrieval will be implemented using the ethers.js v6 library, leveraging its provider and contract interaction capabilities.
-   **Balance Display:** The user's balances for the selected "token in" and "token out" will be displayed in the UI, providing clear visibility of their available funds for trading.

## Technology Stack

-   **Framework:** Next.js
-   **Styling:** Tailwind CSS
-   **Component Library:** shadcn/ui
-   **Web3 Library:** ethers.js v6
-   **Data Fetching:** SWR
-   **Bundler:** Bun
-   **Linter/Formatter:** Biome
