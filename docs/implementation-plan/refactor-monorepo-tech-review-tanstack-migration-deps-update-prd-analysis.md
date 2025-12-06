# Monorepo DX Refactor & Tech Stack Review Plan

## Background and Motivation

AetherDEX has grown into a multi-surface product spanning smart contracts (Foundry/Vyper), a Go backend, and a Next.js-based web interface. Development velocity is slowing because each surface lives in its own silo with duplicated tooling, inconsistent dependency lifecycles, and unclear long-term product direction. Leadership requested a holistic plan to:

- Restructure the repository into a cohesive monorepo that improves DX for smart-contract, backend, and frontend teams.
- Re-evaluate the chosen technology stack (contracts, backend, frontend) for scalability, vendor lock-in, and ecosystem fit.
- Assess the feasibility and ROI of migrating the web frontend from Next.js to the TanStack platform (Router, Start, Query, Table, etc.) and explore OpenNext to avoid vendor lock-in.
- Update every dependency surface (contracts, backend, frontend) to the latest secure versions.
- Produce a Product Requirements Document (PRD) covering feature analysis, market analysis, long-term strategy, and an actionable implementation plan.

This plan captures the investigation scope, deliverables, risks, and a phased breakdown so execution can proceed methodically.

## Key Challenges and Analysis

1. **Repository Sprawl & DX friction**
   - Contracts currently live under `backend/smart-contract`, backend Go source under `backend`, and the frontend under `interface/web`. Tooling (Foundry, Go, pnpm/npm) is isolated, so cross-cutting changes require manual wiring and duplicated CI.
   - Lack of shared packages (e.g., ABI/SDK, types, config) forces copy/paste and increases drift between surfaces.

2. **Technology Stack Fit**
   - **Smart contracts:** Foundry (Solidity 0.8.29) + Vyper mix, LayerZero adapters, TWAP oracles. Need confirmation that compiler/tool versions are current, audit readiness, and if additional tooling (e.g., Forge stdlib, Slither, zk-friendly libs) is required.
   - **Backend:** Go 1.25 module using Gin, Redis, Postgres, Geth. Must confirm Go 1.25 availability/stability, check for framework updates (Gin 1.10, Geth 1.16.2, etc.), and identify observability gaps.
   - **Frontend:** Next.js 15 + React 19 + Tailwind 4 preview + TanStack Query 5. Need to evaluate Next vs TanStack Start for routing/rendering, SSR/ISR requirements, and how OpenNext could mitigate Vercel lock-in while keeping Next if migration risk is high.

3. **TanStack Migration Questions**
   - TanStack Start is still beta; migrating off Next implies rebuilding routing, data fetching, SEO, and deployment flows. Need to weigh benefits (full-stack control, server adapters, alignment with React 19) against costs (ecosystem maturity, missing features, SSR caching).
   - Evaluate hybrid approach: continue using Next for app shell while adopting TanStack Router + Query fully within it, or leverage `@tanstack/start` with OpenNext for hosting optionality.

4. **Dependency Currency & Security**
   - Need a reliable inventory for Go modules, npm packages, Foundry deps. Must verify upgrade paths, semver compatibility, code changes required, and security advisories.
   - Plan must include tooling choices (`pnpm` workspaces, Renovate, Dependabot, `forge update`, `go get -u`, etc.).

5. **Product/Market Alignment**
   - Some planned features might be outdated because market shifted (e.g., cross-chain liquidity sync vs. intents-based routing). Need structured market analysis referencing competitor DEXs, aggregator APIs, compliance/regulatory horizon, and wallet UX.
   - PRD should articulate long-term differentiators (e.g., unified cross-chain vaults, modular hook marketplace, yield synchronization) and ensure tech investments support them.

6. **Change Management**
   - Repository restructure impacts CI, documentation, and developer onboarding. Must define migration strategy, incremental checkpoints, and back-out plan.

## Current-State Inventory & DX Pain Points

| Surface | Location(s) | Toolchain & Key Commands | Package Manager(s) | Observations / DX Friction |
| --- | --- | --- | --- | --- |
| Smart Contracts | `backend/smart-contract` | Foundry (`forge test`, `forge script`), Solidity 0.8.29 + Vyper 0.3.10 via `foundry.toml` | `forge install` (git submodules), ad-hoc npm usage for typings | Nested under backend so contract devs must traverse Go tree; ABIs/artifacts not published to frontend/backend; RPC endpoints + wallets inline in `foundry.toml`; no shared env loader; CI must cd multiple times. |
| Backend | `backend` (Go) | Go 1.25 module, `go run cmd/api/main.go`, `go test ./...` | Go modules (`go.mod`), `go.work` only lists backend | README references `cmd/migrate`, `pkg`, `configs` folders that don't exist -> onboarding confusion; Go 1.25 not yet GA; no Make targets for lint/test; contract bindings or SDK not exposed. |
| Frontend | `interface/web` | Next.js 15.3 App Router, React 19, Tailwind CSS `next` (v4 alpha), Vitest | `npm`/`bun` (README says `bun`, scripts use `next dev`), no workspace root | No lockfile committed; README instructions outdated; uses bleeding-edge React/Next/Tailwind which may break; no integration with backend schema/ABIs; TanStack Query already present but Router/Start absent. |
| Tooling/CI & Shared Assets | Root `.github`, `docs`, `scripts`, `temp-vyper-tests` | Makefile, go.work, misc scripts | None unified | No root-level package manager (`pnpm`, `turbo`); `.gitignore` duplicated per app; CI likely needs path-specific steps; no centralized `.env.example`; documentation describes monorepo layout that doesn’t match actual tree. |

**Key Pain Themes:**
- Developers juggle three separate dependency managers (forge/git submodules, Go modules, npm/bun) with no shared lock-step updates.
- Directory naming is misleading (contracts under backend), causing import paths and docs to drift.
- Tooling (lint, test, format) requires manual navigation, so CI time is wasted and contributions are error-prone.
- Lack of shared generated artifacts (ABIs, TypeChain bindings, gRPC/openapi clients) blocks full-stack feature work.

## Proposed Monorepo Architecture & Tooling Strategy

```
AetherDEX/
├── apps/
│   ├── web/                   # Frontend (TanStack/Next hybrid) app
│   └── backend-api/           # Go API (with /cmd, /internal, /pkg)
├── packages/
│   ├── contracts/             # Foundry workspace (Solidity + Vyper)
│   ├── sdk-ts/                # TypeScript SDK + generated viem clients
│   ├── sdk-go/                # Go bindings (abigen) for backend
│   └── ui-kit/                # Shared React components/styles
├── tooling/
│   ├── scripts/               # Cross-cutting scripts (bash/ts)
│   └── ci/                    # Reusable GitHub Actions, lint configs
├── docs/                      # PRDs, ADRs, architecture
├── .config/                   # shared lint/format configs (biome, eslint, prettier)
├── package.json               # pnpm workspace root scripts
├── pnpm-workspace.yaml        # defines apps/* and packages/*
├── turbo.json                 # pipeline orchestrating lint/test/build per target
├── go.work                    # references apps/backend-api and packages/sdk-go
├── foundry.toml               # relocated or referenced via `packages/contracts`
└── .env.example               # single source env template consumed by surfaces
```

### Tooling Decisions
- **Package management:** Adopt `pnpm` workspaces for all JS/TS packages. Record `packageManager` in root `package.json`. Use `pnpm install --filter ...` per project.
- **Task orchestration:** Introduce `turbo` (or `nx`) to define pipelines: `lint`, `test`, `build`, `deploy`. Each workspace declares dependencies (e.g., `apps/web` depends on `packages/sdk-ts`).
- **Smart contracts:** Move Foundry workspace to `packages/contracts` with `forge-std` submodules under `packages/contracts/lib`. Publish ABI snapshots to `packages/contracts/out` and add a script to sync them into `packages/sdk-ts` and `packages/sdk-go` via `turbo` pipeline.
- **Backend Go:** Relocate current `backend` module to `apps/backend-api`. Keep module path `github.com/irfndi/AetherDEX/apps/backend-api` (or keep `backend` but update `go.work`). Introduce `make` targets or `mage` tasks invoked via `turbo` (`turbo run go:test`).
- **Frontend:** Move Next/TanStack app to `apps/web`. Replace local `node_modules` with workspace-managed dependencies. Shared UI/utility code moves into `packages/ui-kit` and `packages/config` to avoid duplication.
- **Shared Config:** Store lint/format configs inside `.config/` and reference via package.json `extends`. Example: `.config/biome.json`, `.config/tailwind.preset.ts`.
- **Env Handling:** Provide root `.env.example` plus `.envrc`. Use `dotenvx` or `direnv` for per-app overrides. Generate typed env definitions via `dotenvx compose print` or `ts-dotenv` in `packages/config`.
- **CI/CD:** Update GitHub Actions to leverage matrix jobs over `turbo run test --affected`. Cache `~/.pnpm-store`, `~/.foundry`, and Go build cache keyed by lockfiles. Because instructions forbid editing CI unless asked, planning stage only documents required changes.

### Incremental Migration Plan
1. **Foundation (Week 1):**
   - Add root `pnpm-workspace.yaml`, `package.json`, `turbo.json`, `.config/biome.json`, `.config/tsconfig.base.json`.
   - Move `interface/web` to `apps/web` (no code changes yet) and wire scripts via `pnpm`. Ensure `pnpm dev --filter web` works.
2. **Contracts (Week 2):**
   - Move `backend/smart-contract` → `packages/contracts`. Update `foundry.toml` paths and `Makefile` references. Provide script `pnpm forge:test` via `turbo` target.
   - Generate ABI bundle + TypeChain/abigen outputs. Publish to `packages/sdk-ts` & `packages/sdk-go` (initial scaffolding) with automated build step `turbo run build --filter=sdk-*`.
3. **Backend (Week 3):**
   - Relocate Go source to `apps/backend-api`. Update `go.work`, module path, and import references. Introduce `Taskfile` or `magefile` to unify commands invoked via `turbo`.
   - Establish `packages/sdk-go` as dependency (module replacement) so backend consumes generated bindings.
4. **Shared UI & Config (Week 4):**
   - Extract design system elements from `apps/web` into `packages/ui-kit`. Provide Storybook or Ladle workspace if needed.
   - Move shared utilities (wallet providers, chains list, viem clients) into `packages/config` & `packages/sdk-ts` for reuse by future apps (mobile, widget).
5. **Toolchain Hardening (Week 5):**
   - Add `turbo` caching, `pnpm` install cache, Renovate/Dependabot config for multi-workspace updates.
   - Document developer onboarding steps and update root README to match new structure.

This architecture keeps each surface isolated but shareable through workspaces and packages, improving DX while enabling incremental rollout without a big-bang refactor.

## Technology Stack Evaluation

| Surface | Current Stack | Alternatives Considered | Strengths | Gaps / Risks | Recommendation |
| --- | --- | --- | --- | --- | --- |
| Smart Contracts | Foundry (Solidity 0.8.29, Vyper 0.3.10), hybrid Solidity/Vyper code, Forge stdlib, OpenZeppelin | Hardhat/Foundry hybrid, Alloy + Forge, use-only Solidity 0.8.28 LTS | Fast iteration, `forge test` coverage, built-in fuzzing, integrates with Vyper compiler, devs already trained | Vyper 0.3.10 lacks latest security patches; no Slither/Manticore automation; `forge test` outputs not surfaced to other surfaces; no TypeChain/abigen pipeline | **Keep Foundry** as primary. Upgrade to Solidity 0.8.30 & Vyper 0.4.0 once audited, add Slither + `forge coverage` gating, adopt Alloy when stable for improved type safety. |
| Backend | Go 1.25 (Gin, GORM, Redis, go-ethereum) | Rust (Axum/Tonic), Node (Nest.js), Go + Fiber/Echo | Large ecosystem for blockchain tooling (go-ethereum), concurrency-friendly, simple deploy pipeline | Go 1.25 not GA; GORM + custom repos adds boilerplate; no GraphQL, no gRPC, limited schema validation; lacks typed contract bindings | **Stay on Go**, downgrade to stable Go 1.22/1.23 now and plan upgrade cadence; replace GORM heavy usage with sqlc for critical paths; add gRPC or GraphQL gateway; auto-generate contract bindings from `packages/contracts`. |
| Frontend | Next.js 15.3 App Router, React 19, Tailwind CSS v4 alpha, TanStack Query 5, Wagmi/Viem | TanStack Start (Router + SSR), Remix, Qwik, SolidStart | Mature ecosystem, strong docs, existing components, server actions, file-based routing | Vendor lock with Vercel features (ISR), using unstable Next 15 and Tailwind 4 causes regressions; limited control over server runtime; router-level customization limited | **Short term:** stay on Next 15 but pin to LTS release (14.2 or 15 stable) and move Tailwind back to 3.4 stable. **Mid term:** adopt TanStack Router + Query inside Next for transition. **Long term:** evaluate TanStack Start once >= RC with OpenNext adapter. |

### Additional Findings & Actions
- **Dev Tooling Upgrades:**
  - Add `slither`, `solhint`, `vyper-check` to contracts CI; store configs under `.config/`.
  - Introduce `golangci-lint` for backend with workspace-level config; integrate with `turbo` target.
  - Replace `biome` CLI scattered usage with root-managed version and unify lint pipeline.
- **Observability:**
  - Backend lacks metrics/tracing; recommend `OpenTelemetry` SDK with OTLP exporter and `temporal` for jobs.
  - Frontend should adopt `sentry` or `highlight.io` for error tracking; use `wagmi` instrumentation hooks.
- **State Management:**
  - Continue using TanStack Query but add `zustand` or `jotai` for client state to avoid prop drilling once migrating away from Next server actions.
- **Testing:**
  - Contracts: enforce `forge snapshot` for gas budgets.
  - Backend: add `integration` package with `testcontainers-go` for Postgres/Redis to remove reliance on manual setup.
  - Frontend: adopt `playwright` for cross-browser e2e since Next/TanStack migration will impact routing.

## Frontend Strategy: TanStack vs Next + OpenNext

### Decision Criteria
- **Hosting Flexibility:** ability to run on AWS, Cloudflare, Fly, Vercel without rewrites.
- **DX & Tooling:** router ergonomics, data fetching, file-based conventions, React 19 compatibility.
- **Web3 Integrations:** Wagmi/Viem hooks, wallet providers, server-side session handling.
- **SSR/Streaming Requirements:** need for RSC, server actions, streaming hydration for quote updates.
- **Time-to-Ship:** amount of refactor needed vs. product roadmap deadlines.

### Option Analysis

| Option | Pros | Cons | Effort | Recommendation |
| --- | --- | --- | --- | --- |
| **Stay on Next.js + adopt OpenNext** | Mature ecosystem, App Router features, server actions, large hiring pool. OpenNext unlocks AWS Lambda@Edge/Cloudflare deploys, removing Vercel lock-in. Minimal rewrite. | Next-specific conventions (app dir, server actions) still exist; vendor-specific features (ISR, image optimization) need polyfills; existing Next 15 + Tailwind 4 instability. | Low | **Adopt immediately.** Pin Next to stable release (14.2.5 or 15.x once stable), integrate OpenNext for Cloudflare/AWS deploy parity, add `next-intl`/`next-swc` config to match hosting targets. |
| **Incremental TanStack Adoption inside Next** (TanStack Router + Query + Start adapters where possible) | Gains best-in-class routing/data caching while retaining Next bundler + RSC. Router allows fine-grained caching, nested routes, and works with React 19. Provides migration runway for future Start adoption. | Some duplication between Next file router and TanStack router; documentation for hybrid approach less mature; potential bundle size increase. | Medium | **Start in Q1.** Use `@tanstack/router` for client-side flows (swap, pools). Keep Next for server rendering + metadata. |
| **Full migration to TanStack Start (beta)** | Complete control over server runtime, first-class adapter for Cloudflare Workers, built-in data caching, typed loaders, no vendor lock. Aligns with TanStack ecosystem. | Still in beta; missing production docs for i18n, image optimization, middleware; fewer UI templates; would require rewriting routing + server functions; integration with Next-specific libs (OpenNext) irrelevant. | High | **Plan for later evaluation** once Start hits RC. Run spike branch using `create-tanstack-app` and evaluate vs requirements checklist. |

### Recommended Path
1. **Stabilize Current Stack (Week 0-1):**
   - Downgrade Tailwind to 3.4 stable; ensure React 19 compatibility validated.
   - Lock Next version (e.g., `15.0.2` or `14.2.5`) and record `packageManager` in `apps/web`.
2. **Introduce OpenNext (Week 1):**
   - Add OpenNext config to build Next artifacts for AWS Lambda@Edge / Cloudflare Workers.
   - Update deployment pipeline to run `pnpm opennext build` and deploy via chosen infra provider.
3. **TanStack Router Hybrid (Week 2-4):**
   - Install `@tanstack/router` + `@tanstack/router-devtools`.
   - Wrap existing Next pages that require client-side transitions (swap, pool, analytics) with TanStack router, leaving marketing pages on Next file routing.
   - Use TanStack loader/actions for data prefetch, bridging to Next server functions.
4. **Evaluate TanStack Start Spike (Week 5-6):**
   - Create PoC using `create-tanstack-app` replicating one vertical (e.g., swap flow) with Wagmi + Query + Router.
   - Measure bundle size, SSR performance, hosting (Cloudflare Workers) using OpenNext-equivalent adapter.
   - Gate go/no-go on stability of Start RC and ability to replace Next features (metadata, image, middleware).
5. **Long-Term Migration Trigger:**
   - Migrate fully once Start offers: (a) stable CLI, (b) production-ready docs, (c) SSR streaming with React 19, (d) file-based asset handling comparable to Next.
   - Even after migrating, keep OpenNext-compatible deployment path for backward compatibility (monorepo can host both apps temporarily under `apps/web-next` and `apps/web-start`).

This phased strategy removes vendor lock immediately via OpenNext, improves DX using TanStack Router today, and leaves door open for a full TanStack Start migration once ecosystem matures—without freezing delivery on current roadmap.

## Dependency Upgrade Blueprint

| Surface | Critical Dependencies (Current) | Target / Notes | Upgrade Steps | Verification & Security |
| --- | --- | --- | --- | --- |
| Smart Contracts | `solc 0.8.29`, `vyper 0.3.10`, `forge-std`, `openzeppelin-contracts`, `v4-core` | Move to `solc 0.8.30`, `vyper 0.4.x`, lock submodules to tagged releases, optionally add `openzeppelin-contracts-upgradeable 5.x` | 1. `cd packages/contracts && forge update`.<br>2. Run `foundryup` → latest; bump versions in `foundry.toml`.<br>3. Refresh `remappings.txt` and run `forge fmt`.<br>4. `npm audit --production` (if TS tooling used) for contract scripts. | `forge test`, `forge coverage --report lcov`, `slither .`, `pip install vyper==0.4.x && vyper --version`. Compare `gas-snapshot` before/after. |
| Backend | Go 1.25 toolchain, `gin v1.10.1`, `gorm v1.30.1`, `go-ethereum v1.16.2`, `redis v9.12.1`, `lib/pq v1.10.9` | Standardize on Go 1.22/1.23. Adopt latest `gin`, `gorm 1.25+`, `go-ethereum 1.16.x patch`, `redis v9.5+`, replace `modernc` libs if unused | 1. Set `toolchain go1.22.5` (or latest stable) in `go.mod`.<br>2. `go get -u github.com/gin-gonic/gin@latest` etc.<br>3. `go mod tidy` and `go mod vendor` (if used).<br>4. Add `renovate.json` to automate module bumps. | `go test ./...`, `go vet ./...`, `golangci-lint run`, `govulncheck ./...`, plus integration tests via `testcontainers-go` for Postgres/Redis. |
| Frontend | `next 15.3.3`, `react 19.0.0`, `tailwindcss 4.0.0`, `@tanstack/react-query 5.65.1`, `wagmi 2.16.3`, `viem 2.22.17` | Pin to stable Next (14.2 LTS or 15.x stable) + React 19 release build, roll Tailwind back to 3.4 until 4 GA, keep TanStack Query/Wagmi/Viem on latest minors, add `@tanstack/router` | 1. Introduce root `pnpm` + lockfile, run `corepack enable`.<br>2. `pnpm dlx npm-check-updates -u --target minor` (scoped) then `pnpm install`.<br>3. Address breaking changes, esp. Next/Tailwind config.<br>4. `pnpm lint && pnpm test && pnpm typecheck && pnpm next build`. | `pnpm audit --prod`, `npx osv-scanner --sbom pnpm-lock.yaml`, `vitest --coverage`, `next build`. Add Playwright smoke hitting wallet mocks. |
| Tooling / CI | No workspace root, scattered `biome`, manual Makefile | Adopt `turbo@latest`, `pnpm@9+`, `.config/biome.json`, `renovate.json`, `direnv`, `dotenvx` | 1. Add root `package.json` w/ `"packageManager": "pnpm@9.x"` and `turbo` scripts.<br>2. Commit `turbo.json` pipelines + caching.<br>3. Configure Renovate to watch Go, npm, git submodules.<br>4. Document upgrade SOP in `docs/engineering/dependency-upgrades.md`. | `turbo run lint test --affected`, ensure CI caches `~/.pnpm-store`, `~/.foundry`, Go build cache. Periodic `npm audit`, `pip audit`, `cargo audit` (if Rust added). |

### Upgrade Cadence & Ownership
- **Weekly (auto):** Renovate opens PRs for npm/go/Foundry updates, run tests via CI, auto-merge patch-level upgrades.
- **Monthly (manual):** Evaluate major upgrades (Next, Wagmi, go-ethereum). Run smoke tests on staging environment.
- **Quarterly (security review):** Run `forge audit` (if license), `slither`, `mythril`, `govulncheck`, `npm audit --production`, `pip audit` for Python scripts.

### Regression Mitigation
- Capture ABI + SDK snapshots before and after upgrades to compare TypeChain outputs.
- Use `git bisect run pnpm test` if regressions occur.
- Maintain fallback Docker images pinned to prior versions for quick rollback.

## PRD Summary
- **Document:** [`docs/prd/monorepo-dx-and-product-strategy-prd.md`](../prd/monorepo-dx-and-product-strategy-prd.md)
- **Feature Analysis:** Classified core components (router, pools, vaults, frontend, SDKs) with status, outlining concrete follow-up tasks for each.
- **Market Insights:** Benchmarked against intents-based aggregators, modular AMMs, and cross-chain liquidity networks to validate differentiation (hook marketplace + vault sync + aggregator support).
- **Long-Term Plan:** Defined phased roadmap (Foundation, Productization, Scale) with KPIs (TVL, MAU, solver fill rate) and release milestones (M1–M4).
- **Implementation Plan:** Split into workstreams (DX/infra, frontend, contracts/backend, product/market) with deliverables and risks (TanStack Start maturity, dependency regressions, bridge security, regulatory needs).

## Implementation Roadmap & Execution Phasing

| Phase | Timeframe | Objectives | Key Deliverables | Exit Criteria |
| --- | --- | --- | --- | --- |
| **M1 – DX Baseline** | Jan-Feb 2025 | Establish monorepo, consistent tooling, secure deployments | pnpm/turbo workspace, OpenNext deployment, dependency upgrades executed, Renovate live | `turbo run lint test` green across apps; OpenNext deployed to staging; Renovate producing PRs |
| **M2 – Feature Complete Alpha** | Mar-Apr 2025 | Productionize contracts/backend and ship SDKs | Router/pool/vault fixes, ABI → SDK pipelines, backend telemetry (OTel) | `forge test` + `go test` + `pnpm test` pass; SDK artifacts published; staging environment mirrors mainnet configs |
| **M3 – Guarded Beta Launch** | May-Jun 2025 | Launch guarded mainnet with hook marketplace + aggregator integration | Hook registry UI, aggregator connectors (0x/Cow), TanStack Router UX, Playwright smoke | Beta users executing swaps with <20bps slippage; aggregator fills recorded; SLO dashboards live |
| **M4 – Scale & Migration** | Jul-Sep 2025 | Expand to more chains, evaluate TanStack Start adoption, release intent API | Multi-chain deployment scripts, TanStack Start spike, solver/intent API alpha | Additional chain online, Start spike report approved, solver API serving pilot partners |

Dependencies, owners, and risk mitigations for each phase are enumerated inside the PRD Implementation section.

## High-level Task Breakdown

1. **Branch Verification & Workspace Prep**  
   - *Description:* Confirm work is happening on `refactor-monorepo-tech-review-tanstack-migration-deps-update-prd-analysis`. Audit `.gitignore`, lint/test tooling, and ensure no local changes conflict.  
   - *Success Criteria:* Branch confirmed, clean working tree, baseline repo map captured.  
   - *Status:* ✅ Done

2. **Current-State Inventory & DX Pain Mapping**  
   - *Description:* Document the present folder layout, tooling per surface, CI hooks, package managers, and known DX friction. Capture this in the plan + diagrams if needed.  
   - *Success Criteria:* Inventory table outlining smart-contract/back-end/front-end tooling, build commands, env requirements, and pain points.  
   - *Status:* ✅ Done

3. **Monorepo Architecture Proposal**  
   - *Description:* Design target structure (e.g., `/apps/web`, `/apps/backend`, `/packages/contracts`, `/packages/sdk`, `/tooling/*`). Specify package managers (pnpm workspaces + Turbo), Go module strategy (`go.work`), Foundry workspace layout, shared config, lint/test orchestration, and CI implications.  
   - *Success Criteria:* Diagram + textual proposal committed to docs, with phased migration steps (e.g., move contracts first, then backend, then frontend).  
   - *Status:* ✅ Done

4. **Technology Stack Evaluation Report**  
   - *Description:* Assess each layer's current stack vs. industry standards (e.g., Foundry vs Hardhat, Go vs Rust, Next vs TanStack). Include pros/cons, ecosystem maturity, hiring considerations, and recommendations.  
   - *Success Criteria:* Written report section with decision matrix and actionable recommendations (continue, enhance, or replace).  
   - *Status:* ✅ Done

5. **Frontend Strategy: TanStack vs Next + OpenNext**  
   - *Description:* Dive deep into TanStack Router/Start capabilities, migration complexity, SSR/ISR needs, DX implications, and hosting strategy. Compare against staying on Next but leveraging OpenNext for infra portability.  
   - *Success Criteria:* Recommendation with rationale, rollout path, and risk mitigation. Includes callouts for Wagmi/Web3 integration, streaming/server actions, and data caching.  
   - *Status:* ✅ Done

6. **Dependency Upgrade Blueprint**  
   - *Description:* Produce upgrade checklists per surface (contracts, backend, frontend). Include tooling commands, breaking-change notes, test coverage requirements, and verification steps (e.g., `forge test`, `go test ./...`, `pnpm lint && pnpm test`).  
   - *Success Criteria:* Documented matrices listing current vs target versions, blockers, and sequencing. Security advisories highlighted.  
   - *Status:* ✅ Done

7. **PRD Draft (Feature, Market, Long-Term Strategy)**  
   - *Description:* Compile feature analysis, market research, competitor benchmarking, user personas, and long-term roadmap aligned with cross-chain DEX trends.  
   - *Success Criteria:* PRD section covering: (a) feature & implementation analysis, (b) market analysis, (c) long-term product plan, (d) KPIs. Sources or assumptions cited.  
   - *Status:* ✅ Done

8. **Implementation Plan & Execution Phasing**  
   - *Description:* Translate findings into an actionable plan (phased milestones, owners, timelines, risk log). Include repository restructure steps, migration spikes, dependency upgrade sprints, and testing strategy.  
   - *Success Criteria:* Implementation roadmap appended to PRD + status board updates. Clear definition of "done" for each phase.  
   - *Status:* ✅ Done

9. **Project Status Board Maintenance**  
   - *Description:* Keep todos/status synced with actual progress. Update after every vertical slice.  
   - *Success Criteria:* Status board reflects reality; blockers are logged in Executor feedback.  
   - *Status:* ☐ Ongoing

10. **[Execution] Establish pnpm Workspace & Root Tooling (M1-A)**  
    - *Description:* Introduce root `package.json`, `pnpm-workspace.yaml`, `turbo.json`, `.config/biome.json`, and align `interface/web` to the workspace without relocating directories yet. Ensure scripts (`pnpm dev --filter web`, lint/test/typecheck) run via pnpm.  
    - *Success Criteria:* `pnpm install` succeeds at repo root; `pnpm web:dev` (or `pnpm dev --filter web`) runs Next successfully; `turbo run lint` executes against web app; documentation updated.  
    - *Status:* ☐ To Do

11. **[Execution] Relocate Frontend to `apps/web` & Update References (M1-B)**  
    - *Description:* Move `interface/web` → `apps/web`, update tsconfig/import paths, package scripts, docs, and workspace globs. Ensure existing tests/lint/build continue to work under pnpm/turbo.  
    - *Success Criteria:* `pnpm dev --filter web` works from new location, Next config + tests updated, docs reflect new path, CI instructions ready.  
    - *Status:* ☐ To Do

## Project Status Board

- [x] Branch verification & workspace prep
- [x] Current-state inventory & DX pain mapping
- [x] Monorepo architecture proposal
- [x] Technology stack evaluation report
- [x] Frontend strategy: TanStack vs Next + OpenNext
- [x] Dependency upgrade blueprint
- [x] PRD draft (feature/market/long-term plan)
- [x] Implementation roadmap & execution phasing
- [ ] [Execution] Establish pnpm workspace & root tooling (M1-A)
- [ ] [Execution] Relocate frontend to `apps/web` (M1-B)
- [ ] Continuous status board maintenance

## Executor's Feedback or Assistance Requests

*(Empty — to be populated during execution.)*

## Lessons Learned

*(Add dated entries as insights emerge during planning/execution.)*
