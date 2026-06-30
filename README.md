# AetherDEX

A lean spot DEX built on Uniswap V4, deployed on Cloudflare stack.

## Architecture

- **Frontend** (`apps/web/`): Vite + React 19 + TanStack Router + Wagmi + DaisyUI
- **Backend** (`apps/api/`): Cloudflare Workers + Hono + Effect TS + D1/R2/KV/Durable Objects
- **Contracts** (`packages/contracts/`): Solidity hooks on Uniswap V4-core + Foundry

## Stack

- Bun (canary) + tsgo (TypeScript 7.0 RC)
- Biome for linting/formatting
- Vitest for unit tests, Playwright for E2E
- Cloudflare: Workers, D1, R2, KV, Durable Objects, Queues, Pages

## Quick Start

```bash
bun install
bun run dev
```

## Workspace Commands

```bash
# Frontend
bun run web:dev
bun run web:build

# Backend
bun run api:dev
bun run api:deploy

# Contracts
bun run contracts:build
bun run contracts:test
bun run contracts:coverage
bun run contracts:deploy:sepolia

# Quality
bun run typecheck
bun run lint
bun run test
bun run test:coverage
```

## Scope

Lean spot DEX: Swap + Concentrated Liquidity + Token Search + Real-time Charts + Wallet Connect + Slippage/MEV protection.

See AGENTS.md for full agent context.
