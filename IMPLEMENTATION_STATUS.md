# AetherDEX Implementation Status & Roadmap

**Date:** December 9, 2025
**Tracking File:** `IMPLEMENTATION_STATUS.md`

This document tracks the readiness of the AetherDEX project across its three main pillars: Smart Contracts, Backend API, and Frontend.

---

## 1. Smart Contracts (`packages/contracts`)

**Overall Status:** ⚠️ **Prototype / Hybrid Transition**
*   **Goal:** Hybrid architecture using Vyper for security-critical Pools and Solidity for Routers/Factories.
*   **Current State:** Core Solidity contracts exist. Critical Vyper contracts are present but marked as `.disabled`.

| Feature | File Location | Status | Notes |
| :--- | :--- | :--- | :--- |
| **Router (Solidity)** | `src/primary/AetherRouter.sol` | 🟡 In Progress | Needs `addLiquidity` productionizing and path logic. |
| **Factory (Solidity)** | `src/primary/AetherFactory.sol` | 🟢 Implemented | Core factory logic appears present. |
| **Pool (Solidity)** | `src/primary/AetherPool.sol` | 🟡 Placeholder? | Checks needed if this supersedes Vyper or vice-versa. |
| **Pool (Vyper)** | `src/security/AetherPool.vy.disabled` | 🔴 Disabled | Currently disabled. Needs to be enabled and verified. |
| **Circuit Breaker** | `src/security/CircuitBreaker.sol` | 🟢 Implemented | Security module present. |
| **Cross-Chain** | `src/primary/AetherRouterCrossChain.sol` | 🟡 Partial | Needs LayerZero/Wormhole integration finalization. |

**Action Items:**
- [ ] Re-enable and test `AetherPool.vy`.
- [ ] Verify `AetherRouter.sol` against updated Pool interfaces.
- [ ] Run `forge test` to establish baseline pass rate.

---

## 2. Backend API (`apps/api`)

**Overall Status:** 🔴 **Skeleton / Not Wired**
*   **Goal:** Go-based REST API for off-chain data, orderbook (if applicable), and indexing.
*   **Current State:** Internal module structure exists (`internal/`), but the entry point (`main.go`) is empty of logic.

| Feature | File Location | Status | Notes |
| :--- | :--- | :--- | :--- |
| **Entry Point** | `cmd/api/main.go` | 🔴 Skeleton | Only DB/Redis init and `/health` endpoint. No business routes. |
| **Pool Module** | `internal/pool/` | 🟡 Partial | `model.go` and `repository.go` exist. Handlers/Service wiring missing. |
| **Auth Module** | `internal/auth/` | 🟡 Partial | Structure exists, needs wiring. |
| **Token Module** | `internal/token/` | 🟡 Partial | Structure exists, needs wiring. |
| **Database** | `internal/database/` | 🟢 Configured | GORM + Postgres setup in `main.go`. |
| **Redis** | `cmd/api/main.go` | 🟢 Configured | Redis client setup present. |

**Action Items:**
- [ ] Register `internal` handlers in `cmd/api/main.go` (Gin router).
- [ ] Implement `Service` layer logic for Pools and Tokens.
- [ ] Create API routes for `/pools`, `/tokens`, `/swap/quote`.

---

## 3. Frontend (`apps/web`)

**Overall Status:** ⚠️ **Migration (Next.js App Router -> TanStack Router)**
*   **Goal:** TanStack Router for type-safe routing, migrating away from standard Next.js App Router patterns.
*   **Current State:** Split personality. `app/` contains a working "Swap" prototype. `src/routes/` contains the new TanStack landing page.

| Feature | File Location | Status | Notes |
| :--- | :--- | :--- | :--- |
| **Landing Page** | `src/routes/index.tsx` | 🟢 Implemented | TanStack Router version. Visuals only. |
| **Swap UI** | `app/page.tsx` | 🟡 Legacy/Proto | Working UI but uses dummy state & hardcoded prices. In `app/` dir. |
| **Trade Routes** | `src/routes/trade/` | ❓ Unknown | Directory exists, need to verify content (likely empty/skeleton). |
| **Wallet Connect** | `components/features/common/Header.tsx` | 🔴 Mock | `console.log` only. Needs Wagmi/Viem integration. |
| **API Integration** | N/A | 🔴 Missing | No fetching from `apps/api` or Blockchain yet. |

**Action Items:**
- [ ] Complete migration of Swap UI from `app/page.tsx` to `src/routes/trade/swap.tsx`.
- [ ] Integrate Wagmi/RainbowKit for real wallet connection.
- [ ] Connect UI to Smart Contracts (Viem) or API.

---

## 4. Documentation & DevOps

| Feature | File Location | Status | Notes |
| :--- | :--- | :--- | :--- |
| **PRD** | `docs/prd/` | 🟢 Complete | detailed roadmap available. |
| **CI/CD** | `.github/workflows/` | 🟡 Existing | `foundry-tests.yml` exists. Need comprehensive CI. |
| **Scripts** | `scripts/` | 🟢 Useful | `slither-all`, `coverage-all` available. |

---

## Summary of Immediate Next Steps

1.  **Backend:** Wire up the `pool` and `token` endpoints in `cmd/api/main.go` to serve data.
2.  **Contracts:** Resolve the `AetherPool.vy` status (enable or fully deprecate in favor of Solidity).
3.  **Frontend:** Port the Swap UI to TanStack Router (`src/routes`) and add real Wallet connection.
