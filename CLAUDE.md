# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

AetherDEX is a decentralized exchange (DEX) platform with concentrated liquidity, advanced routing, and cross-chain capabilities. It's a monorepo with three main components:

- **Frontend** (`apps/web/`): Vite + React 19 + TanStack Router + Tailwind CSS
- **Backend** (`apps/api/`): Go REST API with Gin, GORM, PostgreSQL, Redis
- **Smart Contracts** (`packages/contracts/`): Hybrid Solidity/Vyper using Foundry

## Common Commands

### Full Stack (Docker)
```bash
make dev                    # Start all services (frontend:3000, api:8080, postgres, redis)
make test                   # Run all tests
make lint                   # Lint all components
make build                  # Build all services
```

### Frontend (`apps/web/`)
```bash
bun install                 # Install dependencies (from root)
bun dev                     # Start dev server (port 3000)
bun run build              # Production build
bun run lint               # Lint with Oxlint
bun run typecheck          # TypeScript checking
bun test                   # Run Vitest tests
bun run test:e2e           # Run Playwright E2E tests
```

### Backend (`apps/api/`)
```bash
go mod download            # Install dependencies
go run cmd/api/main.go     # Run API server (port 8080)
go test ./...              # Run all tests
go test -cover ./...       # Run with coverage
go fmt ./...               # Format code
```

### Smart Contracts (`packages/contracts/`)
```bash
# Setup Vyper environment first
make setup-contracts       # Creates venv with Vyper 0.4.3

# Then run commands
forge build                # Build contracts
forge test -vvv            # Run tests with verbosity
forge coverage             # Generate coverage report
forge fmt                  # Format Solidity code
make contract-test         # Run tests (handles Vyper PATH)
```

### Single Test Execution
```bash
# Frontend - single file
bun test src/hooks/useSwap.test.ts

# Backend - single package
go test -v ./internal/swap/...

# Contracts - single test
forge test --match-test testSwapExactInput -vvv
```

## Architecture

### Smart Contract Layer
- **Hybrid approach**: Vyper for security-critical pools (`src/security/`), Solidity for routers/factories (`src/primary/`)
- **Provider Abstraction Layer (PAL)**: Multi-provider cross-chain support (LayerZero, Axelar, 0x)
- **Key contracts**: `AetherRouter.sol`, `AetherFactory.sol`, `AetherPool.vy`, `AetherRouterCrossChain.sol`
- **Uniswap V4 integration**: Uses v4-core for concentrated liquidity

### Backend Layer
- **Domain-driven design**: Logic organized in `internal/` by domain (pool, liquidity, swap, token, transaction, user)
- **Entry points**: `cmd/api/main.go` (API), `cmd/migrate/main.go` (migrations), `cmd/worker/main.go` (background jobs)
- **Data access**: Repository pattern in `internal/repository/`
- **WebSocket support**: Real-time price feeds via `internal/websocket/`

### Frontend Layer
- **Routing**: TanStack Router with file-based routes in `app/`
- **Wallet integration**: Wagmi v2 + Web3Modal + MetaMask SDK + Coinbase SDK
- **State**: React 19 with hooks in `hooks/`
- **Components**: Radix UI primitives with Tailwind styling in `components/`

## Key Patterns

- **Path aliases**: Frontend uses `@/*` for root imports
- **Go workspace**: Multi-module coordination via `go.work`
- **Foundry remappings**: `forge-std/`, `@openzeppelin/contracts/`, `v4-core/`
- **Vyper contracts**: Require Python venv with Vyper 0.4.3 (use `make setup-contracts`)

## Configuration

- Solidity compiler: 0.8.31 with optimizer (1000 runs), EVM Cancun, VIA IR enabled
- Vyper version: 0.4.3
- Line length: 120 characters (both Solidity and TypeScript)
- Go version: 1.25+
- Node version: 24+
- Bun version: 1.2+

## Database

```bash
make db-migrate            # Run migrations
make db-reset              # Reset database
```

Migrations are SQL files in `apps/api/migrations/{up,down}/`.
