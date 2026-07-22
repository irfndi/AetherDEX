# AetherDEX

A non-custodial **autonomous concentrated-liquidity platform** on Uniswap V4 — visual-range LP, single-sided zaps, one-click rebalance, and V4-native TP/SL (via the `AetherHook` TWAP oracle). Robinhood-Chain-first, multi-chain (Ethereum + L2s), deployed entirely on the Cloudflare stack.

## Architecture

- **Frontend** (`apps/web/`): Vite + React 19 + TanStack Suite (Router/Query/Form/Table/Virtual) + `@effect/rpc` client + Wagmi + DaisyUI
- **Backend** (`apps/api/`): Cloudflare Workers + Hono + Effect TS v4 + `@effect/rpc` + D1/R2/KV/Durable Objects
- **Contracts** (`packages/contracts/`): Solidity hooks on Uniswap V4-core + Foundry

> **Architecture note — Effect v4 + `@effect/rpc` are the *target* (planned) architecture, not what is installed on this branch.** This branch is **pre-migration**: `apps/api/package.json` still pins **`effect@^3`** and has **no `@effect/rpc` dependency** yet, so the backend currently runs on Effect v3 and the client has no `@effect/rpc` resolver. The upgrade to **Effect v4** and the **end-to-end `@effect/rpc`** contract (server via `@hono/effect`, client via the TanStack-Query resolver) is delivered by **Workstream P (PR #302)**; the "Effect TS v4 + `@effect/rpc`" entries above describe where the architecture is heading, not the current dependency state.

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
