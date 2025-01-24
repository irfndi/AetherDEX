# AetherDEX Project Overview

This document provides a comprehensive overview of the AetherDEX project, including its vision, features, roadmap, technology stack, and contributor guidelines.

## Vision

Become the most accessible DEX through seamless wallet integration and optimized liquidity routing.

## Core Features (MVP)

- Connect User Wallet
- Select Network (Polygon zkEVM default)
- Select Tokens (POL/USDC default)
- Token Swaps (Uniswap V3-style)
- Slippage Optimization (using 0x API, see 'documents/feature-mechanism.md' for details)
- Multi-Chain Smart Routing (using 0x API, see 'documents/feature-mechanism.md' for details)
- Fee Collection

```mermaid
graph TD
    A[User Wallet] --> B{Connect Wallet}
    B --> C[Select Network (zkEVM default)]
    C --> D[Select Token (POL/USDC default)]
    D --> E{Swap/Limit Order}
    E --> F[Slippage Optimization]
    F --> G[Smart Routing (Multi-Chain)]
    G --> H[Fee Collection]
```

## Monorepo Structure

This project is structured as a monorepo, with the following directories:

-   `interface/web`: Contains the frontend web application built with Next.js, Bun, Biome, Tailwind CSS, and Shadcn.
-   `backend/smart-contract`: Contains the smart contracts for the DEX, written in Solidity and using Foundry for development and testing.
-   `backend/web`: Contains the backend web services built with Hono and Cloudflare Workers.

## Roadmap

AetherDEX is being developed in three phases:

### Phase 1: Build on Polygon (MVP)

-   **Core Features:** Basic DEX features (Swap, Limit Buy/Sell), Connect Wallet, Multi-Chain Support, Upgradable Smart Contracts, Revert/Rollback Mechanism, Circuit Breaker.
-   **Tech Stack:** Solidity, Foundry, Next.js, Bun, Biome, Tailwind CSS, Shadcn.
-   **Deployment:** Polygon zkEVM Cardona Testnet, Polygon zkEVM Cardona Mainnet.
-   **Monetization:** 0.3% swap fees.

### Phase 2: Optimize and Scale on Polygon

-   **Advanced Features:** Concentrated Liquidity (Uniswap V3-style pools), Staking and Yield Farming, Cross-Chain Swaps (AggLayer).
-   **Ecosystem Integration:** Partnerships, RWA tokenization, Gaming integrations.
-   **Community Building:** Governance token, Liquidity mining.

### Phase 3: Expand to Other Networks

-   **Solana:** High-speed transactions, low fees, DeFi/NFT ecosystem.
-   **Ethereum:** Largest DeFi ecosystem, institutional trust, Layer 2 scaling.
-   **Binance Smart Chain (BSC):** Low fees, retail adoption, high-yield farming.

## Technology Stack

### Backend

-   **Smart Contracts:** Solidity, Foundry
-   **Web Framework:** Hono

### Frontend

-   **Framework:** Next.js
-   **Styling:** Tailwind CSS
-   **Component Library:** shadcn/ui
-   **Web3 Library:** ethers.js v6
-   **Data Fetching:** SWR
-   **Bundler:** Bun
-   **Linter/Formatter:** Biome

### Network

-   **Blockchains:** Polygon zkEVM Cardona (initial focus), Solana, Ethereum, BSC (future)

## Contributor Guidelines

### Workflow Process

1.  Fork the AetherDEX repository.
2.  Create a feature branch: `git checkout -b feature/your-feature-name`
3.  Make changes and commit: `git commit -m "Your commit message"`
4.  Push branch to your fork: `git push origin feature/your-feature-name`
5.  Submit a pull request (PR) to the main AetherDEX repository.

### Code Submission Requirements

-   Focus on Functionality, prioritize MVP features.
-   Solidity Development: Foundry, best practices, tests.
-   Uniswap Interface Modification: Minimal changes, document clearly.
-   Testing: Unit tests for Solidity and JavaScript, high coverage.
-   Documentation: Update relevant documentation files.

### Review Standards

-   Code Review by at least one developer.
-   Focus on MVP Goals and timeline.
-   Constructive Feedback.

## Testing and Deployment

-   All smart contracts must pass all tests with 100% coverage before deployment to mainnet.
-   Testnet deployments for thorough testing before mainnet.
