# AetherDEX - Project Context

## Project Overview

**AetherDEX** is a comprehensive decentralized exchange (DEX) platform built as a monorepo. It features a modern web interface, a robust Go backend, and smart contracts for the Ethereum ecosystem.

*   **Architecture:** Monorepo managed by `bun` and `turbo`.
*   **Core Components:**
    *   **Frontend:** Next.js 15, React 19, Tailwind CSS (located in `apps/web`).
    *   **Backend:** Go (Golang) REST API and worker services (located in `apps/api`).
    *   **Smart Contracts:** Solidity and Vyper, managed with Foundry (located in `packages/contracts`).

## Key Directories

*   **`apps/web/`**: The Next.js frontend application.
*   **`apps/api/`**: The Go backend services, API, and workers.
    *   `api/`: REST API definitions.
    *   `cmd/`: Entry points for services.
    *   `internal/`: Private application logic, organized by domain (`liquidity`, `pool`, `token`, `transaction`, `user`).
*   **`packages/contracts/`**: Foundry project for Solidity/Vyper contracts.
    *   `src/primary/`: Main Solidity contracts (Routers, Factories).
    *   `src/security/`: Critical Vyper contracts (Pools).
    *   `src/_archive/`: Deprecated or legacy contracts.
*   **`docs/`**: Comprehensive project documentation (Architecture, API, Guides).
*   **`scripts/`**: Utility scripts for testing, coverage, and deployment.

## Building and Running

### Prerequisites
*   Node.js (v24+) & Bun (v1.2+)
*   Go (v1.25+)
*   Foundry (forge, cast, anvil)

### Common Commands

**Root Workspace:**
*   **Install Dependencies:** `bun install`
*   **Start Development (Frontend):** `bun dev` (or `bun dev --filter web`)
*   **Build All:** `turbo run build`
*   **Lint:** `turbo run lint`
*   **Test:** `turbo run test`

**Smart Contracts (`packages/contracts/`):**
*   **Test:** `forge test` (or `forge test -vvv` for verbosity)
*   **Build:** `forge build`
*   **Coverage:** `forge coverage` (or use `scripts/coverage-all`)
*   **Static Analysis:** `scripts/slither-all` (requires Slither)

**Backend (`apps/api/`):**
*   **Install Deps:** `go mod download`
*   **Run API:** `go run cmd/api/main.go`
*   **Test:** `go test ./...`

## Development Conventions

*   **Language Hybridity:** The smart contract layer uses a hybrid approach with **Vyper** for security-critical core logic (pools) and **Solidity** for interaction layers (routers).
*   **Testing:**
    *   **Contracts:** Extensive usage of Foundry (`forge`). 100% coverage target for critical logic.
    *   **Frontend:** Vitest for unit/integration tests.
*   **Linting & Formatting:**
    *   Uses **Oxlint** for JS/TS.
    *   **Foundry** (`forge fmt`) for Solidity.
    *   Standard `go fmt` for Go.
*   **Documentation:** Keep `docs/` updated with architectural changes.
*   **Security:** Regular static analysis (Slither) and pre-commit checks are encouraged.

## Important Files
*   `package.json`: Defines the workspace structure (bun/turbo).
*   `turbo.json`: Configures the task pipeline.
*   `docs/development-guide.md`: Detailed workflow for smart contracts.
*   `packages/contracts/foundry.toml`: Foundry configuration.
