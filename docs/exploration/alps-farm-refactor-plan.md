# Exploration: Pivoting AetherDEX Toward Alpine-Style Autonomous Liquidity

| | |
|---|---|
| **Status** | Exploration / proposal — no implementation committed |
| **Branch** | `explore/alps-farm-refactor` |
| **Author** | Sisyphus (AetherDEX) |
| **Decision needed from** | Project owner |
| **Relates to** | AGENTS.md product scope, Wave 3+ roadmap, Workstream P (Effect v4 / TS 7 / Bun canary) |

---

## 1. TL;DR

`alps.farm` is not a generic multi-protocol yield aggregator. It is a **non-custodial liquidity-provider (LP) terminal focused exclusively on Uniswap v3 + v4 on Robinhood Chain**, with a deliberately opinionated UX ("set your range on the mountain"), single-sided deposits, one-click rebalancing, and on-chain take-profit / stop-loss for v3 positions. It monetizes through a single, immutable **0.1% entry fee**, 70% of which funds a buyback-and-burn of a `$ALPS` token.

The strategic finding of this exploration is a **structural advantage AetherDEX already holds**:

> Alps' own docs state *"v4 has no TP/SL: v4 core ships no price oracle, so there is nothing safe for a keeper to verify triggers against."* AetherDEX's `AetherHook.sol` **already records a 1024-slot observation buffer with in-band observations** — the storage substrate a keeper-safe oracle needs. **Caveat: the present read path (`getCurrentTwap`) is *not* yet a true time-weighted average** — it returns a cumulative delta over *sample counts*, not divided by *elapsed time* — so completing a correct TWAP (see §9 **G2.5**) is explicit Phase-0 / pre-Phase-2 work. Once corrected, AetherDEX can offer **V4-native autonomous LP tooling (TP/SL, auto-recenter) that Alps explicitly cannot build on v4** — turning Alps' stated limitation into AetherDEX's differentiator.

Because the two projects share nearly the entire modern TypeScript DeFi stack (wagmi v3 + viem v2 + Reown AppKit + Hono + TanStack Query + Foundry), adopting Alpine patterns rests on **compatible foundations — but it is a non-trivial migration, not a 1:1 port**: it requires the missing Uniswap SDKs, a correct quote engine, wiring the bypassed Effect services + unrouted WebSockets, and the parallel Bun/TS/Effect-v4 modernization (§10). The stack is shared; the work is real.

**Recommendation (proposed, pending owner decision):** re-prioritize the Wave 3+ roadmap toward an "Alpine-style LP terminal" positioning — keep the lean spot-DEX core, but make **concentrated-liquidity UX and v4-native automation** the headline, monetized with a flat 0.1% immutable fee. **In parallel, run Workstream P (§10): modernize the toolchain to Bun canary + stable TypeScript 7 + all-latest deps, and adopt Effect v4 as the actually-used backend paradigm.** See Section 9 for the phased plan, Section 10 for the parallel toolchain + Effect v4 workstream, and Section 11 for the forks that require a decision.

---

## 2. Correcting the Premise

The original brief described Alps as an aggregator that "tracks 11 protocols" with "$3.73M 24h volume / $51.05M active pools." Research contradicts the framing:

| Claim in brief | Finding | Source |
|---|---|---|
| "Aggregates and displays liquidity pool data" across protocols | **False.** Alps surfaces only **Uniswap v3 and v4 pools on Robinhood Chain**. No cross-protocol aggregation. | alps.farm/docs (Getting Started) |
| "Tracks 11 protocols" | **Misleading.** The homepage "Protocols" metric reads `Uniswap v3 + v4`. The "11" likely confuses pool count for protocol count. | alps.farm homepage |
| Broad yield-farming platform | **False.** It is an LP position-management terminal: pick pool → set range → deposit → rebalance. | alps.farm/docs |
| Revenue from 0.1–0.5% on yields, listing fees, arbitrage | **Partially true.** Reality is a single **flat 0.1% on deposit/pool-creation only**; everything else (close, collect, rebalance, TP/SL) is free. | alps.farm/docs/fees |

There are actually **two "Alps" products** from the same team (ETHGlobal OpenAgents 2026 winners):

1. **`alps.farm` (production)** — non-custodial LP terminal on Robinhood Chain. **Closed source.** Contracts verified on Blockscout.
2. **`yanisepfl/alps` (hackathon)** — ERC4626 **autonomous vault** on Base. **Open source (MIT)**: Next.js 15 frontend, Bun + Hono keeper, Bun + Hono + SQLite backend, Foundry contracts, KeeperHub orchestration, Claude-narrated agent feed.

The hackathon repo is the valuable reference: it is inspectable source for the keeper, indexer, and vault-adapter patterns AetherDEX would adapt — but AetherDEX should adopt the **non-custodial production model**, not the custodial vault (vaults are explicitly out of AetherDEX scope; see AGENTS.md "Dropped").

---

## 3. Alps.farm Feature Catalog

### 3.1 Production (alps.farm — Robinhood Chain)

| Feature | What it does | V4 relevance |
|---|---|---|
| **Visual range setting** | Liquidity depth histogram rendered as a "mountain"; drag handles to set a concentrated range; live-price pill follows the cursor; ranges **snap to valid ticks via the pool's `tickSpacing`** (a distinct v4 PoolKey parameter, *not* the fee tier). | Portable to v4 **provided the adapter/router preserves `tickSpacing`**. |
| **Single-sided deposits (zap)** | One token in → router computes an out-of-range position in the correct orientation. No ratio math, no leftover dust. | Fully portable to v4. |
| **Auto-balancing zap** | For ranges straddling market price, the router auto-swaps to the correct Uniswap orientation before minting. | Fully portable to v4. |
| **One-click rebalance** | Close → collect fees → re-mint a recentered single-sided range in one guided flow. New range computed from **live price at execution time**, fees compound, no swap needed (single-sided). | Fully portable to v4. |
| **Pool creation** | Create any Uniswap v3/v4 pool with opening liquidity in one flow; **re-checks on-chain price at execution** so a frontrun init reverts instead of minting at a bad price. | Fully portable to v4. |
| **Take Profit / Stop Loss** | On-chain TP/SL for **v3 only**. Approve NFT to Alps router, register order; a keeper closes when **spot AND TWAP** both breach a trigger (anti-flash-loan), 5% slippage cap, order expiry, proceeds only to owner. | **V3 only — v4 has no oracle.** This is AetherDEX's opening. |
| **Playground** | Paper-trading LP simulator with live pool data, no wallet required. | Portable. |
| **PnL & History** | Cost-basis reconstruction from on-chain events; realized PnL with hourly candle valuation. **Stored in the browser, not the server.** | Portable (different storage model — see §11, fork 5). |
| **Volume alerts** | Toast + chime + Telegram when any tracked pool trades > \$1M in 5 min. | Portable via existing DO WebSocket. |
| **Telegram bot** | Read-only position tracking, range alerts, volume spikes, shareable PnL cards. | Optional add-on. |
| **Impact page** | Tracks all pools launched through Alps and their live TVL. | **Out of AetherDEX scope** (locked: no standalone analytics — link to DexScreener). |
| **Folio (portfolio)** | Aggregated view of all your positions. | Portable. |

### 3.2 Hackathon (yanisepfl/alps — autonomous vault, Base)

| Feature | What it does | AetherDEX relevance |
|---|---|---|
| **5-policy decision engine** | Range-drift, anti-whipsaw cooldown, realized-volatility, idle-reserve, cap-pressure policies evaluated every 5 min. | **High** — the *policy logic* is reusable inside a keeper even without a vault. |
| **KeeperHub orchestration** | Polling (5-min schedule), reactive (post-rebalance audit), manual demo workflows. | AetherDEX uses **Cloudflare Queues + Cron** instead (in-scope, already built). |
| **Event indexer** | 5-second-poll on-chain indexer feeding SQLite (block cursor, balances, FIFO lots, fees, pool orientation cache). | **High** — AetherDEX has **no indexer today** (see §6.2, gap #4). |
| **V3/V4 adapters** | `UniV3Adapter`, `UniV4Adapter`, `UniversalRouterAdapter` abstract position math. | Reference implementation for AetherDEX's tick-math gap. |
| **Sherpa chat + AI narration** | Claude-powered chat + narrators that curate keeper reasoning. | **Out of scope** for a DEX. |
| **ERC4626 custodial vault** | Users deposit USDC, receive a vault token holding a basket of CL positions. | **Out of scope** (AetherDEX dropped Vaults). |

---

## 4. Tech-Stack Alignment — Compatible Foundations, Non-Trivial Migration

| Dimension | Alps.farm (prod) | yanisepfl/alps (hackathon) | **AetherDEX (current)** | Fit |
|---|---|---|---|---|
| Frontend framework | Next.js (App Router) | Next.js 15 + React 19 | **Vite 8 + React 19** | Different bundler, same React 19 |
| Wallet | Reown AppKit + wagmi v3 + viem v2 | Reown AppKit + wagmi v3 + viem v2 | **Wagmi v3 + Reown AppKit + viem v2** | **Identical** |
| Data fetching | TanStack Query | TanStack Query | **TanStack Query (in use in route components; some routes still on raw `fetch`)** | **Identical** |
| API server | Read-only server | Bun + Hono | **Cloudflare Workers + Hono + Effect** | **Same routing (Hono)** |
| Persistence | None server-side (browser) | SQLite (WAL) | **D1 + R2 + KV + Durable Objects** | AetherDEX is *more* capable |
| Auth | SIWE | SIWE → JWT | **SIWE (built)** | **Identical** |
| Realtime | WSS (inferred) | WSS (Hono) | **Durable Objects WebSocket (built, unrouted)** | Compatible |
| Contracts | Solidity (verified, immutable) | Foundry/Solidity (ERC4626 + adapters) | **Foundry + Solidity 0.8.31 + V4-core + OZ v5** | **Same toolchain** |
| Chain lib | viem v2 | viem v2 + Uniswap v3/v4 SDK | **viem v2** (no Uniswap SDK yet) | Add `@uniswap/v3-sdk` + `@uniswap/v4-sdk` |

**Conclusion:** The only *new* dependencies AetherDEX needs are `@uniswap/v3-sdk` and `@uniswap/v4-sdk` (for correct tick math — see §6.2, gap #3). Most of the stack maps across, but this is **compatible foundations + a non-trivial migration** — closing the Effect-bypass, WebSocket-routing, quote-correctness, position-ownership, and modernization gaps (§6.2, §10) is genuine work, not a zero-cost drop-in.

---

## 5. Revenue / Business-Model Analysis

### 5.1 Alps' model

- **One fee, taken once:** flat **0.1%** on deposits routed through the Alps contract and on the first liquidity of a created pool.
- **Everything else free:** close, claim fees, rebalance withdrawals, TP/SL executions.
- **Immutable:** rate is hardcoded in the contracts; **no admin function can raise it.**
- **Token flywheel:** 70% of collected fees fund a **weekly buyback-and-burn** of `$ALPS` (on Virtuals Protocol, Robinhood Chain). Every step is a public, verifiable transaction.
- **Contracts are trust-minimized:** verified on Blockscout, hold no funds between txs, **no owner, no upgrade path, no pause switch.**

Deployed contracts (Robinhood Chain, verified):
- v3 router (zap + TP/SL): `0xeE147478b8910F426fDD5cE763F75EE9F3DD842E`
- v4 router (zap): `0x40f6b7ea708118f551b5b7371590275d10767bc8`
- Pool creator: `0x229d8db5f2bdbb4c4bb98cf4ffdb8d7d7ea041ea`

### 5.2 Competitive fee landscape

| Platform | Custody | Fee model |
|---|---|---|
| **Alps.farm** | **Non-custodial** | **0.1% flat, once**; 70% → buyback/burn |
| Gamma Strategies | Custodial vault | 5–10% performance fee on profits |
| Arrakis Finance | Custodial vault | 0.1–0.3% mgmt + 10–15% performance |
| Revert Finance | Non-custodial + automation | 2% on compounded fees + per-action |
| Beefy Finance | Custodial vault | ~0.5% performance + 0.1% strategist |
| Yearn Finance | Custodial vault | 2% management + 20% performance |

**Positioning insight:** Alps is the **lowest-friction fee** in the category and pairs non-custodial custody with the simplest possible pricing. For AetherDEX — whose differentiator would be *v4-native automation* — a flat immutable 0.1% entry fee is credible and easy to communicate.

### 5.3 Does "this type of platform make money"?

The brief's revenue hypotheses map to reality as follows:

| Hypothesis from brief | Verdict |
|---|---|
| Trading/performance fees (0.1–0.5%) on yields/swaps | **Simplified** to a single flat 0.1% on deposit only — no recurring performance fee. |
| Protocol listing fees for visibility | **Not used.** Alps is single-protocol (Uniswap). |
| Spread/arbitrage | **Not used** as a revenue stream. |
| Native token + governance | **Token yes, governance no.** `$ALPS` is a pure economic/cultural buyback-burn token with no documented governance. |
| Premium features / paid analytics | **Not used.** All features free beyond the entry fee. |

It *can* make money, but the winning model here is **radical fee simplicity + token buyback**, not feature-gating.

---

## 6. AetherDEX Current-State Assessment

Independent catalog of the codebase (`bg_58a9fd22`). Legend: **COMPLETE** = production-ready; **FUNCTIONAL** = works with known gaps; **SCAFFOLD** = structure, not wired; **PLACEHOLDER** = stub.

### 6.1 Frontend (`apps/web/`) — ~75%

| Route | Status | Gap |
|---|---|---|
| `/swap` | FUNCTIONAL | Balances hardcoded `"0.0"` (T29); `TokenSearch` uses 4 hardcoded tokens, not the API. |
| `/pools` | COMPLETE | — |
| `/pools/$poolId` | FUNCTIONAL | "Add Liquidity" button **disabled** ("Coming in T29"). |
| `/charts/$tokenAddress` | COMPLETE | — |
| `/portfolio` | **PLACEHOLDER** | Static text only; no positions/balances/history. |

- `PriceTicker` connects to `/ws/prices/` — **that endpoint does not exist yet**.
- TanStack Query is configured and used in some route components (e.g. `/charts/*` via `PoolStats`), but other routes still use raw `fetch` + `useState`/`useEffect`.
- No Add/Remove Liquidity UI. A **Playwright E2E suite exists** (`apps/web/playwright.config.ts` + `test:e2e` nav/swap/visual specs, `test:e2e` script) — coverage is **partial**, not absent. Minimal Framer Motion usage.

### 6.2 Backend (`apps/api/`) — ~80%

- All HTTP routes implemented (health, quote, swap build/record, pools, tokens, positions, full SIWE auth).
- **Gap #1 — Effect layer bypassed:** `PoolService` / `TokenService` / `queries.ts` are built but HTTP routes use raw `c.env.DB.prepare()`. The architecture exists but is unused.
- **Gap #2 — Dead WebSocket:** `WebSocketHubDO` + `OrderBookDO` are fully implemented (hibernation API) but **no Hono route mounts the `/ws/*` upgrade paths.** `PriceTicker` connects to nothing.
- **Gap #3 — Quote approximation (critical):** `SwapService` quotes via constant-product using `liquidity` as a proxy for both reserves — **not real V4 tick math**. The code comment admits this.
- **Gap #4 — No on-chain indexer:** all D1 data is seeded, not indexed from chain events. No event listener / subgraph / block sync.
- **Gap #5 — No MEV protection** (in scope per AGENTS.md, zero implementation), no rate limiting, no circuit breaker.
- Wrangler `database_id` / KV namespace id / `ROUTER_ADDRESS` / `FACTORY_ADDRESS` are **placeholders** — nothing is deployed.

### 6.3 Contracts (`packages/contracts/`) — ~90%

| Contract | Status | Notes |
|---|---|---|
| `AetherHook` (349 LOC) | **FUNCTIONAL** | Fee *accounting* only — `afterSwap` increments `accruedFees0/1` but **no fee is actually charged or transferred yet** (`withdrawFees` only clears the counters); fee **settlement** is required work (Phase 4). **1024-slot observation circular buffer** (TWAP *read path* needs fixing — see §9 G2.5). **Ownable** admin incl. a mutable `setProtocolFee` setter. Hook-permission validation. |
| `AetherRouter` (386 LOC) | **FUNCTIONAL** | `swapExactIn/Out`, `addLiquidity`, `removeLiquidity` via unlock/callback; SafeERC20, ReentrancyGuard, slippage + deadline checks. **Caveat:** positions are currently **router-held** (`modifyLiquidity` called from the router) with **no per-user ownership check** on removal — compatible with the locked **non-custodial NFT model** only after migrating to PositionManager NFTs or authenticated position accounting (required before Phase-1 liquidity UX). |
| `AetherFactory` (111 LOC) | COMPLETE | Pool creation via `poolManager.initialize()`, registry, CEI, deterministic PoolId. |
| `AetherHookAddressMiner` | COMPLETE | CREATE2 salt miner for hook address flags. |

- Tests: Hook 547 LOC / 30+ tests (incl. TWAP + fuzz), Router 533 LOC (MockPoolManager), Factory 254 LOC, fuzz invariant suite with 7 invariants.
- **Not deployed**: no on-chain addresses wired into wrangler.

### 6.4 The one existing asset that changes everything

`AetherHook.sol` **already records TWAP observations**. Alps cannot do v4 TP/SL because *v4 core has no oracle*. AetherDEX's hook is precisely the oracle layer Alps is missing. This is the technical foundation for **v4-native TP/SL and auto-recenter** — the feature set Alps gates behind "v4 not supported."

---

## 7. Applicability Map

### 7.1 Directly applicable — high value (port to AetherDEX)

| Alps pattern | AetherDEX home | Effort |
|---|---|---|
| Visual depth-chart range selector | New `RangeSelector` on `/pools/$poolId` + new `/liquidity` page | Medium |
| Single-sided deposit / zap | `AetherRouter` zap method + build service | Medium |
| One-click rebalance (close→collect→re-mint) | Effect service + bundled tx builder | Medium |
| Pool creation flow + frontrun price re-check | `AetherFactory` + create-pool UI | Medium |
| Volume-spike alerts | Existing `WebSocketHubDO` + Cron threshold check | Low |
| Playground / paper LP | Client-side simulator component | Medium |
| PnL & history | On-chain event parsing + browser storage (or D1) | Medium |
| Stale-price + TWAP guards on mint | Router/keeper validation | Medium |

### 7.2 AetherDEX's differentiator — Alpine features Alps *can't* ship on v4

| Feature | Alps status | AetherDEX path |
|---|---|---|
| **V4 TP/SL** | Blocked (no v4 oracle) | Use `AetherHook` TWAP slot as keeper-verifiable trigger source |
| **V4 auto-recenter keeper** | Not offered | Same TWAP + Cron/Queue policy engine (port yanisepfl 5-policy logic) |
| **V4 single-sided auto-zap** | Has it on v4 already | Match parity, then exceed with automation |

### 7.3 Architecturally aligned — adopt as practice

- **Immutable / trust-minimized contracts — a *target*, not the current state.** Today `AetherHook` is **Ownable** with a mutable `setProtocolFee` setter and `AetherRouter` holds positions itself. Alps' production contracts already meet this bar; AetherDEX gets there only via concrete contract changes — **remove the fee setter and redeploy** to make the 0.1% rate immutable (Phase 4), plus the **position-ownership migration** to a non-custodial NFT model (Phase 1). Do not describe the on-chain fee/contracts as immutable until those changes land.
- **Non-custodial tx assembly in-browser, server reads chain only.**
- **SIWE nonce + TTL** (already built).
- **Hono + Effect + DO/KV/R2** realtime (already built; just wire the routes).

### 7.4 Out of scope (do NOT adopt — AGENTS.md scope lock)

| Alps pattern | Why out |
|---|---|
| ERC4626 autonomous vault | AetherDEX dropped Vaults. Non-custodial model is the correct choice. |
| Custodial position basket | Violates non-custodial + lean scope. |
| KeeperHub external SaaS | Use Cloudflare Queues + Cron (already in stack). |
| Claude AI narration / Sherpa chat | Not a DEX feature; adds cost/complexity. |
| `$ALPS` on Virtuals Protocol | AetherDEX has no token (a decision — see §11). |
| Robinhood-Chain-only focus | AetherDEX targets broader chains; Robinhood is one deployment target at most. |
| Multi-protocol aggregation | AetherDEX is a DEX, not a DeFiLlama-style aggregator. |

---

## 8. The Pivotal Insight (restated)

Alps positions "autonomous LP" as its brand, yet its **autonomy is limited to v3** (TP/SL keeper needs an oracle v4 lacks). AetherDEX already owns the missing primitive:

```text
Alps v4   = zap + fee lane only        (no TP/SL, no auto-recenter)
AetherDEX = zap + fee lane + AetherHook TWAP oracle
            ⇒ can add: v4 TP/SL, v4 auto-recenter keeper, range-drift policies
```

A marketing-grade claim follows naturally, **with scoping (defensible only once G2.5 lands and dated competitor research is added)**: *"AetherDEX is among the first DEXes, to our knowledge, to bring autonomous (TP/SL + auto-recenter) concentrated-liquidity management to Uniswap v4 — the feature Alps reserves for v3."* This is a reason to exist beyond "another DEX."

---

## 9. Proposed Roadmap Re-Prioritization

This reframes the existing AGENTS.md "Wave 3+" backlog around the Alpine LP thesis rather than discarding it. Phases assume owner signs off on §11 forks.

### Phase 0 — Foundation & validation gate (unblock realtime + correctness)

> **Phase 0 is a foundation and validation gate, not low-risk work.** G2 replaces the core quote math, G3 changes the backend architecture, and G5 deploys + validates end-to-end.
> **Exit criteria:** (1) unit + integration tests cover the new quote engine — **including cross-tick cases** — and the Effect-routed paths; (2) the corrected TWAP read path (G2.5) passes time-weighted + fuzz tests; (3) contracts + bindings deploy to **Sepolia**; (4) an **end-to-end** swap/quote validation passes against the deployed contracts.
> **Rollback:** the new quote engine and Effect routing ship behind the existing routes (feature-flag / env) so the prior path is restorable; deployment bindings are env-config (revertible). **Do not start Phase-1 liquidity UX until this gate is green** (see §13).

- **[G1] Wire the WebSocket DOs**: add Hono `/ws/*` upgrade routes to `WebSocketHubDO` / `OrderBookDO`. (~5–10 LOC each; unblocks `PriceTicker`.)
- **[G2] Fix the quote engine**: replace constant-product approximation with real V4 tick math via `@uniswap/v4-sdk` (`TickMath`, `LiquidityAmounts`). **For swaps crossing an initialized tick this is not exact from current price + aggregate liquidity alone — it also needs initialized-tick state (`liquidityNet`) — so G2 reads from an on-chain quoter / `StateView` (or ingests tick state) rather than the current-price-only D1 row, since the full indexer lands in Phase 3.** **Critical — current quote is wrong for CL.**
- **[G2.5] Make the TWAP real (pre-automation gate)**: `AetherHook` already records a 1024-slot observation buffer, but `getCurrentTwap` returns a cumulative delta over *sample counts*, not a *time-weighted* average. Fix the accumulator + read path to weight by **elapsed time** (observation timestamps) and to **normalize swap direction** (reciprocal prices for reverse-direction swaps); add time-weighted + fuzz tests — **before** any Phase-2 TP/SL/auto-recenter logic relies on it.
- **[G3] Route HTTP through Effect services**: make pools/tokens routes use `PoolService`/`TokenService` instead of raw D1. Aligns with intended architecture.
- **[G4] Wire `TokenSearch` to the Uniswap default token list** (drop the 4-token hardcode). Per the scope lock — *"Custom token lists → use Uniswap default list"* — token search sources the **canonical Uniswap default token list** (`https://tokens.uniswap.org`), fetched and validated (schema + address checksums); real balances are then fetched on-chain for that list. It must **NOT** be wired to a custom AetherDEX-maintained D1 `tokens` table seeded by `migrations/0002_seed_data.sql` — that would re-introduce the dropped "custom token lists" feature. If a D1 `tokens` table is kept, it is strictly a *cache of the Uniswap default list*, never a separately curated list.
- **[G5] Deploy bindings**: replace placeholder D1/KV/Router/Factory ids; deploy contracts to Sepolia for end-to-end validation.

### Phase 1 — Concentrated-liquidity UX (the Alpine core)
- **Liquidity page** with visual depth-chart range selector (mountain silhouette, drag handles, tick snapping, live-price guard).
- **Single-sided zap**: `AetherRouter.addLiquiditySingleSided` + build service ("one token in, correct orientation out").
- **One-click rebalance** flow on `/positions`.
- **Pool creation flow** with execution-time price re-check.
- **Portfolio / Folio** page: positions + PnL (start with D1 + on-chain event parse).

### Phase 2 — V4-native automation (the differentiator)

> **Depends on** the Phase-0 TWAP fix (G2.5) being real and validated, and on the router position-ownership migration (Phase 1).

- **TP/SL contract module** on top of the corrected `AetherHook` TWAP: owner-only proceeds, spot+TWAP dual trigger, slippage cap, expiry.
- **On-chain verification gate (required before any fund-moving action)**: the keeper reconciles position state **on-chain** (closes/transfers/range) via a quoter / `StateView` before executing — it **never trusts client-supplied D1 data** (today `routes/positions.ts` inserts client-supplied pool/tick/liquidity and never reconciles on-chain). **Unattended at-scale automation additionally requires the Phase-3 indexer; until then Phase-2 automation is reconciliation-gated per action.**
- **Keeper**: Cloudflare Cron + Queue policy engine (port yanisepfl 5-policy logic: range-drift, anti-whipsaw, volatility, idle-reserve, cap-pressure). **Includes a funded transaction-signer / relayer model** — a securely-keyed signer (Workers secret), a chain **RPC binding**, a **gas-funding budget**, and an authorization policy for which orders may execute. *(New work: no RPC binding / signer / relayer exists today — CF Cron/Queue scheduling alone cannot submit a transaction.)*
- **Auto-recenter** for out-of-range v4 positions.

### Phase 3 — Engagement + correctness
- **Volume-spike alerts** (DO + threshold check; optional Telegram bot, read-only).
- **Playground / paper LP** simulator.
- **On-chain indexer** (block cursor + event log) replacing seeded D1 data — **prerequisite for trustworthy PnL and for *unattended* automation at scale** (indexing / on-chain verification must precede any fund-moving automation that runs unattended).
- **MEV protection** (in-scope, currently missing) + rate limiting + circuit breaker.

### Phase 4 — Monetization (gated by §11 decisions)
- **Immutable 0.1% fee** on deposit/pool-creation in `AetherHook`/`AetherRouter`.
- **Optional token flywheel**: if owner approves a token, weekly buyback-and-burn; otherwise route fees to treasury.
- ~~**Impact page**~~ — **out of scope** (locked scope drops standalone analytics pages; link to DexScreener instead). Requires an explicit owner scope change before inclusion.

---

## 10. Parallel Workstream P — Toolchain Modernization + Full Effect v4 Adoption

> **Runs in parallel with Phases 0–4, not after them.** Requested explicitly to ride alongside the refactor. It is foundational: the autonomous-LP keeper, indexer, and quote engine (Phases 1–3) should be *built on* the modernized substrate from day one, not migrated onto it later.

Two halves: **P1** modernizes the toolchain to latest; **P2** makes Effect the *actually-used* backend paradigm at **Effect v4**.

### P1 — Toolchain to latest

The AGENTS.md baseline already names Bun canary + TypeScript 7 (via tsgo); this workstream *executes and completes* that mandate as a one-time catch-up plus ongoing discipline (AGENTS.md: "latest stable, no pinning; weekly Dependabot").

| Item | Action | Notes / breaking changes |
|---|---|---|
| **TypeScript 7.0 stable (native)** | Replace the current `@typescript/native-preview` pin (root, `apps/web`, `apps/api`) with the **stable `typescript@^7.0.x`** package. | TS 7.0 shipped **2026-07-08** — a native (Go) compiler, 8–12× faster builds. `@typescript/native-preview` is **superseded**; nightlies now resume as `typescript@next`. |
| **TS 7 config migration** | Update every `tsconfig.json`. | New defaults: `rootDir`→`./` (set an explicit `rootDir`), `types`→`[]` (must list `["bun", …]` explicitly), `baseUrl` **removed** (use relative `paths`), `module`→`esnext`, `strict`→`true` (already strict). AetherDEX's `target: es2025` + `moduleResolution: bundler` are already compliant. |
| **Bun canary** | Standardize on **Bun canary** (`bun --canary`; Bun 1.4.x canary) as the sole runtime + package manager across root/`apps/web`/`apps/api`. | Already AGENTS.md intent (`1.4.0-canary.1`). Set `packageManager` + CI to canary. |
| **Full dependency refresh — latest, always** | `bun --canary update` **every dependency to the latest available**, then re-run `typecheck` + `lint` + `test` + `build`. Any **newly added** dependency is pulled at latest too. | wagmi v3, viem v2, Hono, Vite, React 19, DaisyUI 5, the Effect v4 ecosystem, **add `@uniswap/v3-sdk` + `@uniswap/v4-sdk`** (Phase-0 G2). **Web leverages the full TanStack Suite** — Router + Query (existing, at latest) plus **Form / Table / Virtual** added when first used in the UI. **Flagged exception: Tailwind stays v3** (DaisyUI-5 based; v4 is a separate visual task — owner to confirm). |

### P2 — Full Effect v4 adoption

AGENTS.md designates Effect TS as the backend paradigm (business logic, DI via `Layer`, typed errors, structured concurrency). Today the codebase (a) pins Effect **v3** with independent `0.x` `@effect/*` versions, and (b) **bypasses its own Effect services** — HTTP routes hit raw `c.env.DB.prepare()` instead of `PoolService`/`TokenService` (Gap #1 / Phase-0 G3). This workstream fixes both.

**Step 2a — Upgrade to Effect v4.** *(v4 is currently in **beta** — `4.0.0-beta.x`. Decide: pin the latest beta now, or hold on latest v3 until v4 GA. See §11 fork 7.)* Breaking changes AetherDEX must absorb (from the official migration docs):

- **Single shared version.** All ecosystem packages align to one number: `effect@4.x` pairs with `@effect/sql-d1@4.x`, `@effect/sql@4.x`, `@effect/vitest@4.x`, `@hono/effect@4.x` at the *same* `4.x`. v3's independent `effect@3.x` + `@effect/sql@0.x` versioning is gone.
- **Package consolidation.** `@effect/platform`, `@effect/rpc`, etc. are merged **into core `effect`**; the `@effect/sql-*` drivers **stay separate** (so `@effect/sql-d1` remains, bumped to `4.x`). Remove deps now merged into core.
- **`Effect.Service` → `Context.Service`.** v4's `Context.Service(…, { make })` **no longer auto-builds a layer**. Every service — `PoolService`, `TokenService`, `KvService`, `R2Service`, `PriceService`, `SwapService` — must define an explicit `static layer = Layer.effect(this, this.make).pipe(Layer.provide(…deps))`.
- **API renames / semantics.** `Effect.catchAll` → `Effect.catch`; Yieldables (`Option`/`Either`) no longer auto-coerce to `Effect` — use `.asEffect()` or `Effect.gen` + `yield*`.
- **`sql` is an unstable module** (`effect/unstable/sql`) — `@effect/sql-d1` consumers may see minor-version churn; pin exact versions and gate behind tests.

**Step 2b — Route HTTP through Effect services (Gap #1 / G3).** `routes/pools.ts`, `routes/tokens.ts`, `routes/positions.ts` must call `PoolService` / `TokenService` / `PositionService` via the `@hono/effect` bridge instead of raw D1. `db/queries.ts` becomes the single D1 access path. *(This is already Phase-0 G3; P formalizes it as part of the v4 migration so the API touches Effect exactly once.)*

**Step 2c — Build all new backend on Effect v4 from day one.** The quote engine (V4 tick math), on-chain indexer, TP/SL keeper + 5-policy engine, and automation are written as Effect services/layers with `Data.TaggedError` typed errors and `Layer` DI — leveraging Effect's structured concurrency exactly where the keeper needs it. **This is why P runs parallel to the refactor, not after.**

**Frontend stays Effect-free** per AGENTS.md (Wagmi/viem/TanStack Query). *Optional extension:* `@effect/rpc` for end-to-end typed contracts between the Hono+Effect API and the React client — see §11 fork 8.

### P sequencing (parallel to phases)

| Workstream item | Runs alongside | Principal risk |
|---|---|---|
| P1: Bun canary + TS 7 stable + dep refresh | **Phase 0 (do first — it's the substrate)** | TS 7 config defaults; beta deps |
| P2a: Effect v4 upgrade + package consolidation | Phase 0 | v4 beta churn; unstable-`sql` churn |
| P2b: Route HTTP through Effect services (G3) | Phase 0–1 | Refactor surface — keep tests green |
| P2c: New services (quote/indexer/keeper) on Effect v4 | Phase 1–3 | Must be designed on v4 from the start |

---

## Parallel Workstream C — CI/CD Modernization (Approved 2026-07-22)

Modernize and optimize GitHub Actions + dependency automation. Landed as a **separate PR after Workstream P** (it builds on the migrated toolchain and must enforce *real* green after the migration).

**Current CI defects (verified):** `continue-on-error: true` masks test/build/coverage failures, so `ci-status` passes even on red; the contracts job re-`forge install`s libs on every run (`lib/` is neither committed nor cached) with an **unpinned Foundry**; Slither is gated on `command -v slither` so it never actually runs; coverage doesn't gate despite the 70/70/90 targets; Dependabot updates npm per-app against a **single root `bun.lock`** → conflicting PR storms. CI **already** uses `bun-version: canary` and script-based steps, so it is consistent with Workstream P (no migration-time change needed).

- **C1 — Correctness gate:** remove the `continue-on-error` masks; make typecheck/lint/test/build mandatory; enforce coverage thresholds (70% backend / 70% frontend / 90% contracts); fix `ci-status` to gate correctly. *(Test types + coverage breadth are expanded in later phases.)*
- **C2 — Fix the contracts job:** pin Foundry; pin + cache `lib/` (forge-std, v4-core, OZ@v5.5.0) so there is no per-run reinstall.
- **C3 — Speed:** cache Bun install + Foundry artifacts; path filters per workspace; a composite setup action (DRY); parallelize the fast checks.
- **C4 — Hardening + QA (approved):** pin actions to SHAs; least-privilege `permissions` per job; actually install & run **Slither, gated** on high/medium; add an **Echidna** fuzz job; **Playwright E2E wiring now** (suite/coverage expanded later).
- **C5 — Dependency automation (free):** adopt **Renovate** (open-source, $0), **self-hosted via `renovatebot/github-action`** with a `renovate.json` tuned for the monorepo (one group per lockfile, lock-file maintenance, conventional commits, labels, PR limits). **Disable Dependabot's npm updates** (the PR-storm source); Renovate owns npm/bun + github-actions. *Owner action: add a fine-grained PAT (`contents:write` + `pull_requests:write`) as the `RENOVATE_TOKEN` secret.* Alternative: the free Mend Renovate GitHub App for public repos (third-party app access).
- **C6 — Process:** **branch protection** on `main` requiring `ci-status` (set via the `gh` admin API if permitted, else owner); **Cloudflare Pages preview-deploy** job wiring now (tests/coverage expanded later).

**Deferred:** Tailwind CSS v4 migration (kept at v3; open a dedicated bead only on explicit request).

---

## 11. Strategic Forks Requiring an Owner Decision

> **All forks below are RESOLVED by the owner (2026-07-22).** See **§14 — Owner Decisions** for the binding answers; `AGENTS.md` has been updated to match. Kept here for the reasoning trail.

These were the open forks:

1. **Positioning:** Stay a *lean spot DEX* (current AGENTS.md lock) **or** re-position as an *autonomous-LP terminal* (the Alpine thesis)? The roadmap above assumes a soft pivot that keeps the DEX core but leads with LP. This is the single biggest fork.
2. **Token / revenue:** Adopt a **0.1% immutable fee + optional buyback-burn token**, or keep feeless / treasury-only? AGENTS.md currently implies no token.
3. **Chain focus:** Multi-chain (current) **or** treat **Robinhood Chain** as a first-class early target (Alps' first-mover arena)? Independent question from #1.
4. **Custody model confirmation:** Stay strictly **non-custodial** (recommended; matches Alps production and AGENTS.md) and explicitly reject the hackathon's ERC4626 vault?
5. **Storage of PnL/history:** Browser-side (Alps' privacy posture) **or** D1-indexed (queryable, but holds user data)?
6. **Scope of "automation":** Is an off-chain **keeper** acceptable within the lean scope, given it is the *only* way to realize the v4 TP/SL/auto-recenter differentiator?
7. **Effect v4 timing (Workstream P, §10):** Adopt Effect v4 **beta now** (absorb churn; standardize the new quote/indexer/keeper services on the v4 API from the start) **or** hold on **latest Effect v3** until v4 reaches GA? This decides whether P pins `effect@4.0.0-beta.x` vs the latest `effect@^3`.
8. **End-to-end typed API (Workstream P, §10):** Keep Effect **strictly on the backend** (AGENTS.md default) **or** adopt **`@effect/rpc`** for typed request/response contracts between the Hono+Effect API and the React client?

---

## 12. Risks & Unknowns

| Area | Risk | Mitigation |
|---|---|---|
| Oracle manipulation | TWAP-based TP/SL triggers could be gamed on low-liquidity pools | Dual spot+TWAP trigger (Alps' approach), minimum-observation/liquidity gates, conservative windows |
| Keeper economics | Off-chain keeper must be funded/gas-managed; failed executions strand orders | Design a **funded signer/relayer authorization model** in Phase 2 (secure key handling, RPC binding, chain-gas budget) — CF Cron/Queue retries are cheap but **cannot submit a transaction without a funded signer**; add execution retries + order expiry on top |
| New chain risk | Robinhood Chain (launched Jul 2026) has unproven longevity | Treat as one target; keep multi-chain core |
| Reference code maturity | `yanisepfl/alps` is hackathon-grade; production alps.farm is closed-source | Port *patterns*, rewrite to AetherDEX standards; do not vendor hackathon code wholesale |
| Audit surface | TP/SL + router handling user funds need formal review | AetherDEX already targets Slither + Echidna + 90% coverage; fund-handling contracts get external audit |
| Quote correctness | Current CL quote is an approximation | Phase 0 G2 is blocking; do not ship liquidity UX on the approximate quote |
| Regulatory / token | A fee token with buyback-burn raises securities questions | Defer token (§11.2); treasury-only fee is the safe default |
| Effect v4 beta (Workstream P) | v4 is `beta`; its APIs (esp. the unstable `sql` module) may churn between betas | Pin exact `effect@4.x` across all `@effect/*`; gate behind the full test suite; keep Effect v3 as fallback until GA |
| TS 7 / dep refresh (Workstream P) | New `tsc` defaults + beta toolchain deps can surface config/type regressions | Apply the `rootDir`/`types`/`baseUrl` fixes per §10 P1; re-run the full quality gate (typecheck+lint+test+build) before merging |

---

## 13. Recommended Next Step (single move)

Before any large re-scope:

> **Execute Phase 0 (G1–G2.5–G5) as a validation gate.** It completes things already half-built (wire the DOs, fix the quote, correct the TWAP read path, deploy bindings, use the Effect services), and — most importantly — **validates the V4 tick-math + TWAP plumbing** that the entire Alpine-pivot thesis depends on. Only after Phase 0 proves the foundation should the owner commit to the Phase 1–4 re-scope.

Concretely, the smallest high-value PR after this exploration is: **wire the WebSocket DOs and replace the approximate quote with `@uniswap/v4-sdk` tick math**, since both are prerequisites and unblock everything downstream.

---

## 14. Owner Decisions (Resolved — 2026-07-22)

All forks are **resolved by the owner**. This is the locked direction; `AGENTS.md` has been updated to match.

| # | Question | Decision |
|---|---|---|
| 1 | Positioning | **Farm / autonomous concentrated-liquidity (soft Alpine pivot).** Multi-chain: **Ethereum + L2s**, with **Robinhood Chain as the first-mover beachhead** (new chain, capital inflow). |
| 2 | Revenue / token | **Flat immutable 0.1% protocol fee → treasury multisig. No token for now.** A buyback-burn token needs launch liquidity + fee-funded market buys = capital, ops and securities risk — the opposite of "robust, secure, 0 capital." A flat on-chain fee to a treasury earns revenue with **zero capital outlay**. Token remains a *future option* once traction justifies it. |
| 3 | Off-chain keeper | **Yes.** Keeper = our logic running on **Cloudflare Workers (Cron + Queues)** that manages on-chain positions. Locks the principle: **mutable policy off-chain (Workers); immutable safety invariants on-chain (contracts)** — changing strategy never needs a redeploy. |
| 4 | Chain focus | **Robinhood Chain first**, then Ethereum + L2s. |
| 5 | Custody | **Non-custodial aggregator** (confirmed). Users keep their Uniswap position NFTs; AetherDEX builds/signs txs + runs the keeper + indexes data. **Reject the ERC4626 vault** — simpler, smaller audit surface, strongest trust. |
| 6 | PnL / history | **D1-indexed, server-side via Workers** (not browser-only). Positions/history are public on-chain data (we never hold keys), so the privacy tradeoff is minimal; we leverage the existing Workers/D1/KV stack for queryable analytics & portfolio. |
| 7 | Effect | **v4 now** (beta accepted). Pin exact `effect@4.x` across all `@effect/*`; gate behind tests; keep v3 as a documented fallback until GA. |
| 8 | @effect/rpc | **Adopt @effect/rpc end-to-end.** Define the API as typed `RpcGroup`s + shared Schema; server resolves via `@hono/effect`, client consumes via the `@effect/rpc` TanStack-Query resolver. Effect spans the API contract (server + client + schema); UI/state stays React/TanStack Query. |
| 9 | Bun | **`bun --canary`** pinned as runtime/package manager in CI + `packageManager`, accepting canary churn. |

**Resulting scope shift:** AetherDEX re-positions from "lean spot DEX" to a **non-custodial autonomous concentrated-liquidity platform** — Uniswap v3+v4 LP tooling (visual ranges, single-sided zaps, one-click rebalance, **V4-native TP/SL via the AetherHook TWAP oracle**), an off-chain Workers keeper, multi-chain (Robinhood-first, ETH + L2s), funded by a flat 0.1% immutable fee to treasury.

### Frontend & dependency policy (additional owner directive, 2026-07-22)

- **Web is built on the TanStack Suite — leverage it fully, not just Query.** TanStack **Router** (file-based, already used) and TanStack **Query** (server state — fed by the `@effect/rpc` TanStack-Query resolver per Decision 8) are the base. Adopt the rest **as needed**, at latest: **TanStack Form** (swap / range / TP-SL / slippage forms + validation), **TanStack Table** (pools, positions, PnL/history), **TanStack Virtual** (virtualize long pool/transaction lists). *(TanStack Start is **out** — it's an SSR meta-framework that conflicts with our Vite SPA + separate Workers API.)*
- **Dependency policy — latest, always.** Every dependency — existing bumps **and** any newly added one — uses the **latest available version.** No pinning to old majors. Two owner-flagged, consciously-managed exceptions: **Tailwind stays v3** (DaisyUI 5 is Tailwind-3-based; a v4 migration is a separate visual-engineering task — owner to confirm), and **Effect is pinned to the chosen v4 build** per Decision 7 (v4 is the latest major; it is beta).

---

## 15. Sources

- alps.farm — homepage + docs: `getting-started`, `ranges`, `tp-sl`, `rebalancing`, `fees`, (index, 11 pages)
- `yanisepfl/alps` — MIT open-source repo (hackathon vault; frontend/keeper/backend/contracts at commit `5c10d91`)
- Robinhood Chain Blockscout — verified Alps router/pool-creator contracts
- AetherDEX repo — `AGENTS.md`, `apps/web`, `apps/api`, `packages/contracts` (catalogued via `bg_58a9fd22`)
- Competitor fee data — Gamma Strategies, Arrakis Finance, Revert Finance, Beefy, Yearn (public docs)

> *Note:* production alps.farm application code is **closed source**; only its contracts (verified) and docs are public. The hackathon repo is the inspectable reference for keeper/indexer/adapter patterns.
