# AetherDEX DX & Product Strategy PRD

**Document Version:** 0.1 (2025-01-07)  
**Authors:** Internal DX Task Force  
**Reviewers:** Smart Contracts, Backend, Interface teams  
**Related Branch:** `refactor-monorepo-tech-review-tanstack-migration-deps-update-prd-analysis`

## 1. Executive Summary
AetherDEX aims to deliver a cross-chain, hook-enabled AMM with vault strategies and a modern trading interface. Development momentum has slowed due to fragmented repositories, outdated dependencies, and unclear prioritization relative to market trends (intents-based routing, shared liquidity layers, MEV-aware execution). This PRD defines:
- The DX improvements and architectural changes required (monorepo restructure, TanStack/OpenNext strategy, dependency upgrades).
- The current status of major product features and what remains to reach production quality.
- A market and competitive assessment to validate that planned features are still relevant.
- A 12-month roadmap with phased execution milestones and measurable KPIs.

## 2. Goals & Non-Goals
### Goals
1. **Unify developer experience** across contracts, backend, and frontend via a proper monorepo and tooling.
2. **Ship a competitive cross-chain DEX** that differentiates on modular hooks, vault-based yield syncing, and aggregator integrations.
3. **Eliminate vendor lock-in** on the frontend by blending TanStack Router with Next and adopting OpenNext for multi-cloud deployments.
4. **Stay secure and current** by upgrading dependencies and instituting automated update cadences.
5. **Provide clear market alignment** so engineering focuses on the highest-impact features.

### Non-Goals
- Rewriting the backend in a different language in the current cycle (Go remains primary).
- Launching on every L2/L3 simultaneously; focus on 2-3 chains with the highest ROI first.
- Rolling out a mobile app before the web experience and APIs are production-ready.

## 3. Feature & Implementation Analysis
Status Legend: ✅ Production-ready, ⚠️ Prototype / needs work, ❌ Not started

| Feature / Surface | Description | Current Implementation | Status | Gaps & Next Actions |
| --- | --- | --- | --- | --- |
| Cross-chain Swap Router | Multi-hop routing across L1/L2 with Slippage safeguards | `AetherRouter.sol` with placeholder `addLiquidity`, hardcoded path length, LayerZero hooks | ⚠️ | Productionize liquidity functions, support variable path lengths, add feature flags, integrate LayerZero/Wormhole adapters with retries. |
| Concentrated Liquidity Pools & Hooks | Uniswap v4-style pools with custom hooks (TWAP, dynamic fees) | `AetherPool.vy`, hook libraries, test scaffolding | ⚠️ | Remove test-only logic, finalize `mint/burn` flows, add hook registry with permissions, integrate hook marketplace UI. |
| Vault Strategies & Yield Sync | Vaults aggregating cross-chain yield streams | `AetherVault` solidity + tests | ⚠️ | Align strategy lifecycle with backend jobs, add slashing/guardian controls, expose vault metrics via API. |
| Backend API & Services | Go API for orders, quotes, accounting, notifications | Gin-based service under `backend/` | ⚠️ | Lacks modular structure, no gRPC/GraphQL, needs contract binding generation + observability (OTel, structured logs). |
| Interface (Web) | Next.js 15 + React 19 app with wallet support | `interface/web` | ⚠️ | On unstable Next/Tailwind versions, no TanStack Router, no OpenNext deploy path, lacks design-system extraction and e2e coverage. |
| SDKs (TS & Go) | Reusable clients for partners, bots, internal services | Not present (only viem/wagmi usages) | ❌ | Generate TypeScript SDK from ABIs (TypeChain/viem) and Go bindings (abigen). Publish packages via workspace (npm/go proxy). |
| Ops / Automation | Tooling for deployments, tests, audits | Makefile per surface | ⚠️ | Need Turbo-powered pipelines, Renovate, npm/go audit automation, secret management guidance. |
| Documentation | Docs for devs, partners, auditors | README + scattered markdown | ⚠️ | Update root README to match new structure, add ADRs for TanStack strategy, publish public-facing PRD summary. |

## 4. Market Analysis
### Segment Overview
- **Orderflow aggregators (CoW Swap, UniswapX, 1inch Fusion):** Focus on intent-based matching, MEV protection, off-chain solvers.
- **Concentrated Liquidity AMMs (Uniswap v4, Ambient, Maverick, Algebra):** Offer hooks/plugins, custom price curves, and pro-LP tooling.
- **Cross-chain Liquidity Networks (Thorchain, Jumper/LI.FI, LayerZero DEXs):** Emphasize multi-chain asset movement, risk-managed messaging.
- **Institutional Liquidity Providers:** Demand risk dashboards, automated vault products, and reporting.

### Market Trends
1. **Intent-Based Execution:** Users prefer guaranteed outcomes via intents; DEXs need solver integrations or internal intent engines.
2. **Shared Liquidity Layers:** Projects like Flashbots SUAVE, Anoma, and Across are popularizing shared blockspace/liquidity for multi-chain settlement.
3. **Hooks & Modularity:** Uniswap v4 hooks and Ambient OS feature stores demonstrate appetite for extensibility if DX is solid.
4. **Compliance & Reporting:** Institutional entrants require on/off-chain audit logs, sanctions screening, and real-time risk metrics.

### Competitive Positioning
- **Differentiators to pursue:** Hook marketplace, cross-chain vault sync, aggregator-of-aggregators (0x, 1inch, Cow APIs), account abstraction-friendly wallet UX.
- **Features to deprioritize:** Generic copycat pools without hooks, bespoke wallets (partners already have them), maintaining proprietary bridges (prefer existing bridging layers like LayerZero + Hyperlane for security). 

## 5. Long-Term Product Plan
### 0-3 Months (Foundation)
- Complete monorepo restructure, dependency upgrades, and CI hardening.
- Ship SDKs (TS + Go) and ensure ABI artifacts auto-sync.
- Release OpenNext-backed deployment for web app; add TanStack Router for trading flows.
- KPIs: CI success >98%, `pnpm test` + `forge test` runtime <10 min, developer onboarding <1 day.

### 3-6 Months (Productization)
- Launch beta pools with hook marketplace and cross-chain router in guarded mainnet launch.
- Expose backend gRPC/GraphQL for partners; integrate aggregator orderflow (0x, Cow).
- Add vault dashboards with streaming yield metrics and alerts.
- KPIs: $5M TVL across pools, 1,000 MAU traders, <20 bps average slippage on top pairs.

### 6-12 Months (Scale & Ecosystem)
- Expand to additional rollups (Base, Linea, Scroll) using standardized deployment playbooks.
- Launch solver/intent API for institutional market makers.
- Explore full TanStack Start migration once RC available, enabling Cloudflare Worker hosting with minimal cold-start.
- KPIs: $50M TVL, 5 partner integrations using SDK/API, solver fill rate >80% within SLA.

## 6. Implementation Plan
### Workstream A: DX & Infrastructure
1. Execute monorepo restructure (apps/, packages/, tooling/) with pnpm + turbo.
2. Automate dependency updates (Renovate) and security scans (Slither, govulncheck, osv-scanner).
3. Introduce shared config (.config) and `.env.example` with vault-managed secrets guidance.

### Workstream B: Frontend Evolution
1. Stabilize Next stack (pin versions, revert Tailwind 4 preview), adopt OpenNext deployment.
2. Layer in TanStack Router incrementally; abstract wallet flows into `packages/ui-kit`.
3. Build TanStack Start spike branch for readiness review; document migration blockers.

### Workstream C: Smart Contracts & Backend
1. Productionize `AetherRouter.addLiquidity`, `AetherPool` mint/burn/init flows, feature flags, hook registry.
2. Build automated ABI export + SDK generation pipeline feeding backend + frontend.
3. Add backend modules for quotes, intents, LP analytics, plus metrics/tracing.

### Workstream D: Product & Market
1. Validate hook marketplace UX with design partners; gather feedback on required hook templates.
2. Engage aggregators (0x, Cow, LI.FI) for routing partnerships; align on API requirements.
3. Publish public-facing PRD summary & roadmap updates for community transparency.

### Milestone Timeline
| Milestone | Target Date | Deliverables |
| --- | --- | --- |
| **M1: DX Baseline** | Feb 2025 | Monorepo landing, pnpm workspace, OpenNext deployment, dependency blueprint executed for top packages |
| **M2: Feature Complete Alpha** | Apr 2025 | Production-ready router/pools/vaults in staging, SDKs published, backend telemetry online |
| **M3: Beta Launch** | Jun 2025 | Guarded mainnet deployment, aggregator connections, TanStack router live, hook marketplace beta |
| **M4: Scale & Migration** | Sep 2025 | Evaluate/possibly adopt TanStack Start, onboard 3+ ecosystem partners, >$20M TVL |

## 7. Open Questions / Risks
- TanStack Start maturity timeline is uncertain; maintain fallback strategy if RC slips.
- Dependency upgrades (e.g., React 19, Next 15) may introduce regressions; ensure canary testing + feature flags.
- Cross-chain messaging security depends on third-party bridges; need audits and monitoring.
- Regulatory requirements for vault products may demand KYC/AML features earlier than planned.

## 8. Appendices
- **A:** Reference architecture diagrams (see `docs/architecture/monorepo-refactor.drawio`).
- **B:** Proposed Renovate configuration (to be added under `.github/renovate.json`).
- **C:** Glossary of key terms (hooks, intents, OpenNext, TanStack Start).
