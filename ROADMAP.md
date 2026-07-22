# AetherDEX Roadmap

> Operational backlog. Live tracker: **beads** (`bd list`, `bd ready`) — issue IDs `aetherdex-beads-*`.
> This file is the **authoritative** shared snapshot. `.beads/` is a per-developer local working cache (gitignored) regenerated from this file — it is intentionally not committed, so `ROADMAP.md` is the source of truth on a fresh clone.
> Run `bd setup claude` (or your agent's beads integration) to enable agent context. Updated 2026-07-22.

## Program (epic)

- `aetherdex-beads-adn` — **Autonomous concentrated-liquidity platform ("Alpine pivot")**: non-custodial Uniswap v3+v4 LP automation (visual ranges, single-sided zaps, one-click rebalance, **V4-native TP/SL** via the `AetherHook` TWAP oracle). **Robinhood-Chain-first**, then Ethereum + L2s. Thesis & decisions: [PR #301](https://github.com/irfndi/AetherDEX/pull/301).

## Delivered ✓

- `aetherdex-beads-ymf` — **Workstream P**: toolchain + Effect v4 migration (TypeScript 7 native `tsc`, Bun canary, all deps latest, Effect v4 beta single-version `4.0.0-beta.100`, `@aetherdex/shared` typed RPC, HTTP-routed-through-Effect (Gap #1 fixed), full TanStack suite). **[PR #302](https://github.com/irfndi/AetherDEX/pull/302)** — build green (typecheck/lint/88 tests/vite build/wrangler dry-run).
- `aetherdex-beads-4i1` — **Workstream C**: CI/CD modernization (strict green-gated CI, caching, path filters, SHA-pinned actions, gated Slither, Echidna + Playwright E2E wiring, self-hosted Renovate replacing Dependabot npm). **[PR #303](https://github.com/irfndi/AetherDEX/pull/303)**.
- `aetherdex-beads-659` — Exploration plan + owner decisions locked (autonomous-LP pivot, Robinhood-first, Effect v4, flat 0.1% fee → treasury (no token), non-custodial aggregator, `@effect/rpc` end-to-end). **[PR #301](https://github.com/irfndi/AetherDEX/pull/301)**.

## Forward phases

- `aetherdex-beads-p5o` (P0) — **Phase 0 — Foundation**: wire WebSocket Durable Objects; real V4 tick-math quote (Uniswap v4 SDK); deploy bindings (D1/KV/Router/Factory ids); TokenSearch → API + real balances.
- `aetherdex-beads-y94` (P1) — **Phase 1 — Concentrated-Liquidity UX**: range-selector liquidity page (TanStack Form), single-sided zap, one-click rebalance, pool creation, portfolio/Folio (TanStack Table).
- `aetherdex-beads-nw5` (P1) — **Phase 2 — V4-native automation**: TP/SL on the `AetherHook` TWAP oracle, off-chain keeper (Cron + Queues, 5-policy engine), auto-recenter out-of-range positions.
- `aetherdex-beads-g5t` (P2) — **Phase 3 — Engagement + correctness**: volume-spike alerts, playground (paper LP), on-chain indexer, MEV protection + rate-limit + circuit breaker.
- `aetherdex-beads-60e` (P3) — **Phase 4 — Monetization**: immutable 0.1% protocol fee → treasury multisig (token flywheel deferred), Impact page.

## Decisions & owner actions (open)

- `aetherdex-beads-ura` (P0) — **OWNER ACTION**: add a `RENOVATE_TOKEN` PAT secret with **all three** permissions — `contents:write` + `pull_requests:write` + `Workflows: read and write` (Renovate's `github-actions` manager rewrites `.github/workflows/*`, so without the Workflows permission those updates fail) — and enable branch protection requiring `ci-status`. **Unblocks merging [PR #303](https://github.com/irfndi/AetherDEX/pull/303).**
- `aetherdex-beads-71o` (P1) — **Configure Robinhood Chain (id 4663)**: RPC endpoints, Blockscout explorer, SIWE chain entry, deployment-target wiring (the beachhead).
- `aetherdex-beads-7km` (P2) — **DECISION (open)**: Tailwind CSS v3 → v4? (Kept at v3 for DaisyUI 5 stability; revisit as a dedicated visual migration if approved.)
- `aetherdex-beads-clr` (P3) — **WATCH**: Effect v4 is beta (`4.0.0-beta.100`) — track GA; migrate off beta when a stable v4 ships.

## PR map

| PR | Branch | Content | Status |
|----|--------|---------|--------|
| [#301](https://github.com/irfndi/AetherDEX/pull/301) | explore/alps-farm-refactor | Exploration plan + decisions + Workstream docs + README | open (docs) |
| [#302](https://github.com/irfndi/AetherDEX/pull/302) | feat/effect-v4-toolchain | Workstream P — toolchain + Effect v4 | open, build green |
| [#303](https://github.com/irfndi/AetherDEX/pull/303) | chore/ci-modernize | Workstream C — CI/CD modernization | open, needs owner RENOVATE_TOKEN + branch protection to merge |
| [#304](https://github.com/irfndi/AetherDEX/pull/304) | chore/beads-setup | beads tracker setup (this roadmap + `.beads` gitignore) | open |
