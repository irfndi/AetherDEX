# AGENTS.md — AetherDEX Agent Context

> **This is the single source of truth for agent context.**
> All other agent entry-point files (CLAUDE.md, GEMINI.md, .claude/AGENTS.md, etc.) MUST symlink to this file. If you find inconsistencies elsewhere, this file wins.

## Project Summary

**AetherDEX** is a lean spot DEX built on Uniswap V4, deployed entirely on the Cloudflare stack.

- **Frontend** (`apps/web/`): Vite + React 19 + TanStack Router + Wagmi + DaisyUI
- **Backend** (`apps/api/`): Cloudflare Workers + Hono + Effect TS + D1/R2/KV/DO
- **Contracts** (`packages/contracts/`): Solidity hooks on Uniswap V4-core + Foundry

## Product Scope (Locked)

**LEAN SPOT DEX** — Swap + Concentrated Liquidity + Token Search + Real-time Charts + Wallet Connect + Slippage/MEV protection.

**DROPPED** (do NOT re-introduce):
- Limit orders
- Buy crypto (no fiat)
- Cross-chain UIs
- Vaults (AetherVault system)
- Escrow (Escrow.vy)
- Perpetuals / Perps
- Launchpad / token launches
- Lending markets
- Staking UI
- Bridge UIs
- Custom token lists (use Uniswap default list)
- Standalone analytics pages (link to DexScreener)
- Governance dashboards
- Vyper contracts (Solidity-only now)
- In-house Go backend (replaced by Workers)
- PostgreSQL (replaced by D1)
- Redis (replaced by KV/DO)
- Docker (replaced by Cloudflare)
- Next.js (replaced by Vite)
- Oxlint (replaced by Biome)
- npm/pnpm (replaced by Bun)
- ESLint (replaced by Biome)

## Tech Stack (Latest, 2026-06-30)

### Runtime
- **Bun**: 1.4.0-canary.1 (latest canary, document in tooling/scripts/VERSIONS.md)
- **TypeScript**: 7.0.1-rc (via tsgo — `@typescript/native-preview`)
- **Node**: 24+

### Frontend (`apps/web/`)
- Vite 7 + React 19
- TanStack Router 1.x (file-based) + TanStack Query 5.x
- Wagmi v3 + Viem v2 + Reown AppKit (multi-wallet UI)
- DaisyUI 5 (Tailwind 3) — theme: `aetherdex`
- Framer Motion (animations)
- Lucide icons
- Vitest 4 + Playwright for tests
- Biome for lint/format

### Backend (`apps/api/`)
- Cloudflare Workers (compatibility_date: 2026-06-29)
- Hono 4 (HTTP routing) + Effect TS v3 (business logic, DI, error handling)
- @effect/sql-d1 (D1 queries)
- @hono/effect (Hono+Effect bridge)
- SIWE (Sign-In with Ethereum) for auth
- Viem for on-chain reads
- @cloudflare/vitest-pool-workers for tests
- Biome for lint/format

### Smart Contracts (`packages/contracts/`)
- Foundry (forge, cast, anvil)
- Solidity 0.8.31 (no Vyper)
- Uniswap V4-core (vendored at lib/v4-core)
- OpenZeppelin Contracts v5
- forge coverage target: >90%
- Slither + Echidna for static analysis + fuzzing

### Data Layer (Cloudflare-native)
- **D1** (SQLite) for hot data: active pools, orders, users, positions
- **R2** for trade history archives (jsonl.gz per month)
- **Workers KV** for hot cache: prices, sessions, pool metadata
- **Durable Objects** for WebSocket state + per-pair order book
- **Queues + Cron** for background work
- NO Postgres, NO Redis, NO Hyperdrive (Cloudflare-native only)

## Architecture Overview

```
┌─────────────────────────────────────────────────┐
│                  Cloudflare Edge                  │
│                                                   │
│  ┌─────────┐  ┌──────────┐  ┌────────────────┐  │
│  │ Pages   │  │ Workers  │  │  DO WebSocket  │  │
│  │ (web)   │──│ (api)    │──│  (live data)   │  │
│  └────┬────┘  └────┬─────┘  └────────────────┘  │
│       │            │                              │
│  ┌────┴────┐  ┌────┴─────┐  ┌────────────────┐  │
│  │  D1     │  │   KV     │  │  Durable Obj   │  │
│  │ (pools, │  │ (prices, │  │  (order book,  │  │
│  │  users) │  │  cache)  │  │   WebSocket)   │  │
│  └─────────┘  └──────────┘  └────────────────┘  │
│                                                   │
│  ┌─────────┐  ┌──────────┐                       │
│  │  R2     │  │  Queues  │                       │
│  │ (trade  │  │ (jobs,   │                       │
│  │ history)│  │  settle) │                       │
│  └─────────┘  └──────────┘                       │
└─────────────────────────────────────────────────┘
```

## Commands

### Root
```bash
bun install              # Install workspace deps
bun run typecheck        # tsgo --noEmit
bun run lint             # biome check .
bun run format           # biome format --write .
bun run test             # vitest run (all workspaces)
bun run test:coverage    # Coverage for all workspaces
```

### Frontend (`apps/web/`)
```bash
bun run web:dev          # Vite dev server (port 3000)
bun run web:build        # Production build (dist/)
bun run web:deploy       # wrangler pages deploy
```

### Backend (`apps/api/`)
```bash
bun run api:dev          # wrangler dev (port 8080)
bun run api:deploy       # wrangler deploy
bun run api:deploy:staging
bun run api:deploy:production
```

### Contracts (`packages/contracts/`)
```bash
bun run contracts:build
bun run contracts:test
bun run contracts:coverage
bun run contracts:deploy:sepolia
```

## Conventions

### Code Style (Biome enforced)
- 2 spaces indent, LF line endings
- 120 char line width
- Double quotes for strings
- No semicolons (`semicolons: "asNeeded"`)
- Trailing commas everywhere
- Arrow parens always
- Organize imports enabled
- `import type` for type-only imports

### TypeScript
- Strict mode (strict, noUncheckedIndexedAccess, exactOptionalPropertyTypes)
- ES2025 target, bundler moduleResolution
- @effect/* for backend logic (services, layers, error handling)
- viem/wagmi for on-chain reads/writes on frontend

### Git
- Conventional commits (feat:, fix:, chore:, ci:, docs:)
- Atomic commits
- No push without explicit request
- Husky pre-commit (planned)

### Testing
- Vitest for unit tests
- Playwright for E2E
- Coverage thresholds: 70% backend, 70% frontend, 90% contracts
- TDD: RED → GREEN → SURFACE for every behavior change
- Manual QA: real browser/curl/tmux before claiming "done"

### Dependencies
- Prefer Bun canary + tsgo over Node + tsc
- Use latest stable of each package (no pinning to old versions)
- Dependabot weekly for all ecosystems

## Architectural Decisions

### Why Cloudflare-first?
- Single platform for compute (Workers), storage (D1/R2/KV/DO), edge (Pages)
- Edge-replicated D1 for <5ms reads globally
- Workers free tier: 100K req/day, 10ms CPU
- Workers paid: 30ms CPU, $0.30/M requests
- Containers GA for heavy compute (not needed for lean spot DEX)

### Why Effect TS?
- Type-safe error handling (`Effect.gen`, `catchTag`)
- Dependency injection via `Layer`
- Structured concurrency for background work
- Plays well with Hono via `@hono/effect`
- Workers-compatible patterns via `effect-cf`

### Why Uniswap V4 directly (not custom Vyper pool)?
- Less code = less audit surface
- V4 hooks provide extensibility without forking the AMM
- Battle-tested concentrated liquidity math
- Ecosystem compatibility

### Why no Perps / Lending / Launchpad in v1?
- User picked "Lean spot DEX" scope
- Each addition multiplies scope by 2-5x
- Perps: needs oracle + liquidation engine + funding rate
- Lending: needs collateral management + interest rate model
- Launchpad: needs token creation + bonding curve + graduation logic
- Focus = ship usable spot DEX first

### Why drop Go + Postgres + Redis?
- Workers cannot run Go (V8 isolates only)
- Postgres + Redis require containers (extra cost, latency)
- D1 + KV + DO cover same use cases with edge benefits
- Single language (TypeScript) across stack = simpler ops

## Current State

### Done (Wave 1)
- T1: Nuclear reset (preserve contracts as `.archive-contracts-2026/`, wipe rest)
- T2: Monorepo scaffold (apps/web, apps/api, packages/contracts, root tooling)
- T3: Install deps (Bun 1.4.0-canary, TS 7.0.1-rc, tsgo, Biome 1.9.4, Vitest 4.1.9)
- T4: CI/CD (GitHub Actions: contracts, backend, frontend, ci-status + CodeQL + Dependabot)

### In Progress (Wave 2)
- T5: Foundry contracts scaffold (V4-core + OZ v5)
- T10: Workers API scaffold (Hono + Effect + D1/R2/KV/DO/Queues)
- T20: Vite frontend scaffold (React 19 + TanStack Router + DaisyUI + Wagmi)

### Planned (Wave 3+)
- Wave 3 (10 parallel tasks): V4 hook, Router+Factory, D1 schema, R2/KV/DO services, Effect service layer, Queue/Cron, TanStack Router setup, DaisyUI+Layout
- Wave 4 (7 parallel): Contract tests, SIWE auth, Quote/Swap endpoints, Pool/Liquidity endpoints, Wagmi+Reown, Charts, Token search
- Wave 5 (3 tasks): Slither/Echidna, Swap page, Liquidity page
- Wave 6 (3 tasks): E2E + Visual QA, Testnet deploy, Monitoring

## Reference Materials

### Skills (user-installed)
- `daisyui` — Tailwind component library (mandatory)
- `frontend-design` — frontend design polish
- `web-perf` — Core Web Vitals optimization
- `seo` — metadata, structured data
- `wrangler` — Cloudflare Workers CLI
- `cloudflare` — comprehensive CF platform guide
- `durable-objects` — DO patterns
- `workers-best-practices` — production Workers
- `agents-sdk` — Cloudflare Agents SDK (for chat/AI features later)
- `ccxt-typescript` — CEX price feed integration (future)

### Skills (just-installed via npx skills add)
- `uniswap/uniswap-ai@swap-integration` — DEX swap UI patterns
- `uniswap/uniswap-ai@v4-hook-generator` — V4 hook architecture
- `uniswap/uniswap-ai@v4-security-foundations` — V4 security
- `uniswap/uniswap-ai@v4-sdk-integration` — V4 SDK
- `uniswap/uniswap-ai@viem-integration` — Viem patterns
- `wevm/wagmi@wagmi-development` — Wagmi v3 official
- `patricio0312rev/skills@framer-motion-animator` — UI motion
- `obra/superpowers@verification-before-completion` — QA gate
- `secondsky/claude-skills@tanstack-router` — type-safe routing

### Archived Code (for reference, do not modify)
- `.archive-contracts-2026/` — old Foundry project (with v4-core, OZ v4, AetherPool.vy, etc.)

## Anti-Patterns (Avoid)

### From the old codebase (do NOT recreate)
- AI slop: animate-float on every page, glow-pulse, triple-radial-gradient body
- Identical glass-card treatment everywhere
- Dead Next.js code mixed with Vite
- `"use client"` directives in non-Next.js code
- Hardcoded test bypasses in production contracts (`if x == 1001: assert False`)
- `forge-std/console.sol` imports in production contracts
- Unwired hooks, unused repos, scaffolding with no implementation
- Empty placeholder directories (database/, handlers/, middleware/, services/, utils/)
- Duplicate `lib/utils.ts` and conflicting `Token` interfaces
- 0x000...000 router addresses, hardcoded "0.0" balances
- console.log() as the only implementation for a button
- Documentation that doesn't match code (Next.js refs in Vite project, etc.)

### General principles
- TDD: test first, watch fail, watch pass, exercise surface
- Manual QA: real browser/curl/tmux, not just `lsp_diagnostics`
- Evidence-based completion: artifacts captured, no "should work"
- Cleanup as you go: no temp files, no orphan TODOs
- One wave at a time: don't skip plan waves without explicit override

## Security

- Test coverage >90% for contracts (Slither + Echidna in CI)
- Test coverage >70% for backend (Vitest with @cloudflare/vitest-pool-workers)
- Test coverage >70% for frontend (Vitest + Playwright)
- SIWE auth (Sign-In with Ethereum), no passwords
- Nonce in Workers KV with 5-minute TTL
- Security headers via Hono middleware (CSP, HSTS, X-Frame-Options)
- Rate limiting on /swap endpoints
- Circuit breaker for high-value operations
- Audit required before mainnet deployment (post-testnet validation)

## Pre-mainnet Checklist

- [ ] Testnet deployment validated end-to-end
- [ ] Slither: 0 high/medium findings
- [ ] Echidna: fuzz tests pass on all invariants
- [ ] Forge coverage >90%
- [ ] Backend coverage >70%
- [ ] Frontend coverage >70%
- [ ] E2E: all critical user flows pass on testnet
- [ ] Manual QA: real wallet connection, real swap, real liquidity provision
- [ ] External audit completed and findings addressed
- [ ] Bug bounty program launched
- [ ] Monitoring + alerting operational
- [ ] Incident response plan documented
