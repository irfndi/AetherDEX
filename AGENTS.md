# AGENTS.md — AetherDEX Agent Context

> **This is the single source of truth for agent context.**
> All other agent entry-point files (CLAUDE.md, GEMINI.md, .claude/AGENTS.md, etc.) MUST symlink to this file. If you find inconsistencies elsewhere, this file wins.

## Project Summary

**AetherDEX** is a non-custodial **autonomous concentrated-liquidity platform** on Uniswap V4 (v3+v4 LP tooling: visual ranges, single-sided zaps, one-click rebalance, and **V4-native TP/SL** via the `AetherHook` TWAP oracle), deployed entirely on the Cloudflare stack. **Robinhood-Chain-first**, multi-chain (Ethereum + L2s). (Re-positioned from "lean spot DEX" on 2026-07-22 per the exploration plan — PR #301.)

- **Frontend** (`apps/web/`): Vite + React 19 + TanStack Router + Wagmi + DaisyUI
- **Backend** (`apps/api/`): Cloudflare Workers + Hono + Effect TS + D1/R2/KV/DO
- **Contracts** (`packages/contracts/`): Solidity hooks on Uniswap V4-core + Foundry

## Product Scope (Locked)

**AUTONOMOUS CONCENTRATED-LIQUIDITY PLATFORM (Alpine-style)** — the locked direction decided 2026-07-22 (supersedes "lean spot DEX"):

- **Core:** Uniswap v3 + v4 LP automation — spot swap, visual range ("mountain") selection, **single-sided deposits (zap)**, **one-click rebalance** (close → collect → re-mint), pool creation, PnL & history, real-time charts, token search, wallet connect (SIWE), slippage/MEV protection.
- **Differentiator:** **V4-native TP/SL + auto-recenter** — enabled by `AetherHook`'s 1024-slot **TWAP oracle** (the piece Alps.farm says v4 lacks).
- **Custody:** **Non-custodial aggregator.** Users keep their position NFTs; we build/sign txs in-browser + run an off-chain keeper + index data. **No ERC4626 vault.**
- **Automation:** **Off-chain keeper** on Cloudflare Workers (Cron + Queues). Principle: **mutable policy off-chain, immutable safety invariants on-chain** — strategy changes never need a redeploy.
- **Chains:** **Robinhood Chain first** (beachhead), then Ethereum + L2s.
- **Revenue:** flat **0.1% protocol fee → treasury multisig** — the *locked rate*; made **immutable on-chain** by removing the admin `setProtocolFee` setter and redeploying the contracts (a Phase-4 contract change — until then the deployed hook's fee is owner-adjustable). **No native token for now** (zero capital outlay; token deferred).
- **Data:** PnL/history **D1-indexed, server-side via Workers.** The schema must be **chain-qualified** (composite keys carry `chain_id`) **before a second chain is indexed** — token addresses / deterministic V4 pool-ids / tx hashes collide across chains, so multi-chain ingest needs `chain_id` in keys + filters (or a DB per chain).
- **API contract:** typed end-to-end via **`@effect/rpc`** (shared Schema; server via `@hono/effect`, client via TanStack-Query resolver).
- **Frontend:** full **TanStack Suite** (Router + Query via @effect/rpc + Form + Table + Virtual as needed), all at latest.

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
- ERC4626 custodial vault / position baskets (rejected — non-custodial aggregator instead)
- Native token / buyback-burn (deferred — flat 0.1% fee to treasury for now)
- TanStack Start — SSR meta-framework (conflicts with our Vite SPA + separate Workers API)

## Tech Stack (Latest, 2026-06-30)

### Runtime
- **Bun**: canary (`bun --canary`; Bun 1.4.x canary) — pinned via `packageManager: bun@canary` + CI. (document exact version in tooling/scripts/VERSIONS.md)
- **TypeScript**: **7.0 stable (native Go compiler — 8–12× faster builds)** via the standard `typescript@^7.0.x` package (`tsc`). `@typescript/native-preview` / `tsgo` are **superseded**; nightlies ship as `typescript@next`.
- **TS 7 config rules**: `rootDir` defaults to `./` (set explicitly per workspace), `types` defaults to `[]` (list needed `@types` explicitly), `baseUrl` removed (relative `paths`), `esModuleInterop`/`allowSyntheticDefaultImports` must stay `true`.
- **Node**: 24+

### Frontend (`apps/web/`)
- Vite + React 19
- **TanStack Suite (leverage the full suite at latest — not just Query):**
  - **TanStack Router** — file-based, type-safe routing (in use).
  - **TanStack Query** — server state, fed by the **`@effect/rpc` TanStack-Query client resolver** (typed end-to-end API contract with the Workers backend).
  - **TanStack Form** — swap / range / TP-SL / slippage forms + validation (adopt where the UI needs it).
  - **TanStack Table** — pools, positions, PnL/history tables (sort/filter/paginate).
  - **TanStack Virtual** — virtualize long pool/transaction lists.
- Wagmi v3 + Viem v2 + Reown AppKit (multi-wallet UI)
- DaisyUI 5 (**Tailwind 3** — v4 deferred to preserve the working UI; separate migration) — theme: `aetherdex`
- Framer Motion (animations)
- Lucide icons
- Vitest + Playwright for tests
- Biome for lint/format
- **Dependency policy: latest, always** — every dep at the latest available; new deps added at latest.

### Backend (`apps/api/`)
- Cloudflare Workers (compatibility_date: 2026-06-29)
- Hono 4 (HTTP routing) + **Effect TS v4 (beta-accepted)** — business logic, DI via `Layer`, typed errors (`Data.TaggedError`), structured concurrency
- **Effect v4 rules**: single shared version across all `@effect/*` (`effect@4.x` + `@effect/sql-d1@4.x` + `@effect/vitest@4.x`, …); `@effect/platform`/`@effect/rpc` consolidated into core `effect`; `Effect.Service` → `Context.Service` with explicit `Layer.effect(this, this.make)`; `Effect.catchAll` → `Effect.catch`; Yieldables need `.asEffect()`; `sql` is an unstable module (`effect/unstable/sql`). Keep Effect v3 as a documented fallback until GA.
- @effect/sql-d1 (D1 queries)
- @hono/effect (Hono+Effect bridge) — **all HTTP routes go through Effect services** (no raw `c.env.DB.prepare()`)
- **@effect/rpc** — typed end-to-end API contract (shared Schema; server handlers via `@hono/effect`, TanStack-Query client resolver)
- SIWE (Sign-In with Ethereum) for auth
- Viem + **@uniswap/v3-sdk / @uniswap/v4-sdk** for on-chain reads + correct CL tick math (quotes/zaps/rebalance)
- **Off-chain keeper** (Cron + Queues) for TP/SL + auto-recenter — mutable policy off-chain
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
bun run typecheck        # tsc --noEmit (TypeScript 7 native compiler)
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
- Prefer Bun canary + TypeScript 7 native `tsc` over Node + tsc
- **Use the latest available version of every dependency** (no pinning to old versions); **any newly added dependency starts at latest.**
- Deliberate, owner-flagged exceptions: Tailwind kept at v3 (DaisyUI-5 UI; v4 is a separate visual migration), Effect pinned to the chosen v4 build.
- **Dependency automation = Renovate** (open-source, free; self-hosted via `renovatebot/github-action` + `renovate.json` grouping by lockfile). Replaces Dependabot for npm/bun + github-actions — Dependabot's per-app npm updates caused conflicting PR storms against the single root `bun.lock`.

### CI/CD
- Workstream C (separate PR, after the toolchain migration) modernizes CI to be **green-gated** (no `continue-on-error` masks), with coverage thresholds enforced (70% backend / 70% frontend / 90% contracts) and `ci-status` as the required gate.
- **Security hardening — target, delivered by Workstream C (a separate PR; not yet live on `main`):** Slither installed and gated on high/medium; an Echidna fuzz job; actions pinned to SHAs; least-privilege `permissions` per job; branch protection on `main` requiring `ci-status`. **Until Workstream C merges, these controls do not run in CI** (Slither is currently `command -v`-gated and never actually runs; there is no Echidna job; actions are tag-referenced).
- E2E (Playwright) + Cloudflare Pages preview-deploy are wired into CI early; test types + coverage breadth expand across later phases.
- Dependency automation via Renovate (see Dependencies above).

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

### Why a non-custodial aggregator + off-chain keeper?
- Users keep their Uniswap position NFTs; we never hold funds → smallest audit surface + strongest trust (matches Alps.farm's production model).
- No ERC4626 share/NAV accounting, no custody risk, no vault math → far simpler than the custodial-vault approach.
- **Mutable policy off-chain (Workers Cron/Queue), immutable safety invariants on-chain (contracts):** strategy changes iterate without a redeploy; fund-safety (owner-only proceeds, slippage caps, TWAP-guarded triggers) lives in audited, immutable contracts.
- The `AetherHook` **TWAP oracle is the v4 differentiator**: it gives a keeper something safe to verify TP/SL/auto-recenter triggers against — exactly what Alps.farm says v4 lacks.

### Why Robinhood-Chain-first, then Ethereum + L2s?
- Robinhood Chain launched 2026-07 with Uniswap as its primary AMM; first-mover LP tooling captures new liquidity + volume before competitors.
- The Uniswap v3+v4 stack is chain-agnostic (same SDK + contract pattern), so this is go-to-market sequencing, not lock-in.

### Why a flat 0.1% fee to treasury (no token) for now?
- Zero capital outlay: users pay fees on their own txs; we never fund a token launch, seed liquidity, or execute buybacks.
- Robust + secure: a **locked** 0.1% on-chain fee rate (made **immutable** by removing the admin setter + redeploying in Phase 4) + treasury multisig; no market ops, no buyback logic, no securities exposure.
- A token + buyback-burn is a future option once there is traction and capital appetite.

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

### Re-prioritized (exploration plan, PR #301, 2026-07-22)
- The Wave 3+ backlog below is **re-framed** around the autonomous-LP pivot. Active tracks:
  - **Phase 0** — foundation: wire WebSocket Durable Objects, real V4 tick-math quotes, route HTTP through Effect services, deploy bindings.
  - **Workstream P (parallel)** — **P1 toolchain**: Bun canary + TypeScript 7 stable (`tsc`) + all-latest deps + `@uniswap/v3-sdk`+`v4-sdk` + full TanStack Suite at latest on web; **P2 Effect v4**: single-version `@effect/*` upgrade, `Context.Service` migration, HTTP-via-Effect, `@effect/rpc` end-to-end, new services (quote/indexer/keeper) on Effect v4.
  - Then Phase 1 (CL UX — TanStack Form/Table/Virtual) → Phase 2 (V4-native TP/SL + keeper) → Phase 3 (alerts/playground/indexer/MEV) → Phase 4 (monetization). See `docs/exploration/alps-farm-refactor-plan.md`.

### Planned (Wave 3+, original)
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

> Items marked **(target)** are phased work — Workstream C for CI hardening (Slither/Echidna), Phase 3 for MEV / rate-limit / circuit-breaker — not all live on `main` yet.

- Test coverage >90% for contracts (Slither + Echidna in CI — **target**; gated once Workstream C lands)
- Test coverage >70% for backend (Vitest with @cloudflare/vitest-pool-workers)
- Test coverage >70% for frontend (Vitest + Playwright)
- SIWE auth (Sign-In with Ethereum), no passwords
- Nonce in Workers KV with 5-minute TTL
- Security headers via Hono middleware (CSP, HSTS, X-Frame-Options)
- Rate limiting on /swap endpoints — **Phase 3 target** (not yet implemented; see plan gap #5)
- Circuit breaker for high-value operations — **Phase 3 target** (not yet implemented; see plan gap #5)
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
