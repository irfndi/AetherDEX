# AetherDEX

A non-custodial **autonomous concentrated-liquidity platform** on Uniswap V4 — visual-range LP, single-sided zaps, one-click rebalance, and V4-native TP/SL (via the `AetherHook` TWAP oracle). Robinhood-Chain-first, multi-chain (Ethereum + L2s), deployed entirely on the Cloudflare stack.

## Architecture

- **Frontend** (`apps/web/`): Vite + React 19 + TanStack Suite (Router/Query/Form/Table/Virtual) + `@effect/rpc` client + Wagmi + DaisyUI
- **Backend** (`apps/api/`): Cloudflare Workers + Hono + Effect TS v4 + `@effect/rpc` + D1/R2/KV/Durable Objects
- **Contracts** (`packages/contracts/`): Solidity hooks on Uniswap V4-core + Foundry

## Stack

- Bun (canary) + TypeScript 7 (native `tsc`)
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

Autonomous concentrated-liquidity platform (Alpine-style): spot swap, visual-range concentrated liquidity, single-sided zaps, one-click rebalance, V4-native TP/SL, token search, real-time charts, wallet connect (SIWE), slippage/MEV protection. Non-custodial; off-chain keeper for automation. See the exploration plan (PR #301) for the full thesis + roadmap.

See AGENTS.md for full agent context.
