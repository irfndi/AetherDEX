CONTRACTS_DIR = packages/contracts

# AetherDEX Development Makefile

.PHONY: help install test test-frontend test-backend test-integration test-coverage build clean dev lint format db-migrate db-reset

# Default target
help:
	@echo "Available targets:"
	@echo "  install           - Install all dependencies (build docker images)"
	@echo "  test              - Run all tests"
	@echo "  test-frontend     - Run frontend tests"
	@echo "  test-backend      - Run backend tests"
	@echo "  test-integration  - Run integration tests"
	@echo "  test-coverage     - Run tests with coverage"
	@echo "  build             - Build all components"
	@echo "  dev               - Start development servers"
	@echo "  lint              - Run linting"
	@echo "  format            - Format code"
	@echo "  clean             - Clean build artifacts"
	@echo "  db-migrate        - Run database migrations"
	@echo "  db-reset          - Reset database"

# Install dependencies (Build Docker images)
install:
	@echo "Building Docker images..."
	docker compose build

# Test targets
test: test-frontend test-backend

test-frontend:
	@echo "Running frontend tests..."
	docker compose run --rm web bun test

test-backend:
	@echo "Running backend tests..."
	docker compose run --rm api go test ./... -v

test-integration:
	@echo "Running backend integration tests..."
	docker compose run --rm -e INTEGRATION_TESTS=true api go test -v -run TestAPIIntegrationSuite

test-coverage:
	@echo "Running frontend tests with coverage..."
	docker compose run --rm web bun run vitest run --coverage
	@echo "Running backend tests with coverage..."
	docker compose run --rm api go test -coverprofile=coverage.out -covermode=atomic ./...
	@echo "Coverage reports generated."

# Build targets
build:
	@echo "Building services..."
	docker compose build
	@echo "Building smart contracts..."
	cd packages/contracts && export PATH=$$PWD/.venv/bin:$$PATH && forge build

# Development targets
dev:
	@echo "Starting development servers..."
	@echo "Frontend: http://localhost:3000"
	@echo "Backend: http://localhost:8080"
	docker compose up

# Linting and formatting
lint:
	@echo "Linting frontend..."
	docker compose run --rm web bun run lint
	@echo "Linting backend..."
	docker compose run --rm api go vet ./...
	@echo "Linting smart contracts..."
	cd packages/contracts && export PATH=$$PWD/.venv/bin:$$PATH && forge fmt --check

format:
	@echo "Formatting frontend..."
	docker compose run --rm web bun run format
	@echo "Formatting backend..."
	docker compose run --rm api go fmt ./...
	@echo "Formatting smart contracts..."
	cd packages/contracts && export PATH=$$PWD/.venv/bin:$$PATH && forge fmt

# Clean targets
clean:
	@echo "Cleaning build artifacts..."
	docker compose down -v
	cd packages/contracts && forge clean

# Smart contract specific targets
setup-contracts:
	@echo "Setting up contract environment..."
	cd packages/contracts && uv venv --python 3.13 && uv pip install vyper==0.4.3

contract-test:
	@echo "Running smart contract tests..."
	cd packages/contracts && export PATH=$$PWD/.venv/bin:$$PATH && forge test -vvv

contract-coverage:
	@echo "Running smart contract coverage..."
	cd packages/contracts && export PATH=$$PWD/.venv/bin:$$PATH && forge coverage --report summary --ir-minimum --no-match-coverage "(test|script)"

contract-deploy-local:
	@echo "Deploying contracts to local network..."
	cd packages/contracts && export PATH=$$PWD/.venv/bin:$$PATH && forge script script/Deploy.s.sol --rpc-url http://localhost:8545 --broadcast

# Performance testing
test-performance:
	@echo "Running performance tests..."
	@docker compose run --rm web bun run vitest run __tests__/performance.test.tsx
	@docker compose run --rm -e PERFORMANCE_TESTS=true api go test -v -run TestPerformanceTestSuite ./...

test-performance-frontend:
	@echo "Running frontend performance tests..."
	@docker compose run --rm web bun run vitest run __tests__/performance.test.tsx

test-performance-backend:
	@echo "Running backend performance tests..."
	@docker compose run --rm -e PERFORMANCE_TESTS=true api go test -v -run TestPerformanceTestSuite ./...

# Benchmark tests
bench:
	@echo "Running benchmark tests..."
	@docker compose run --rm api go test -bench=. -benchmem -run=^$

bench-frontend:
	@echo "Running frontend benchmarks..."
	@docker compose run --rm web bun run vitest bench __tests__/performance.test.tsx

bench-backend:
	@echo "Running backend benchmarks..."
	@docker compose run --rm api go test -bench=. -benchmem -run=^$

perf-test:
	@echo "Running performance tests..."
	docker compose run --rm web bun run vitest run __tests__/performance.test.tsx

# Database operations
db-migrate:
	@echo "Running database migrations..."
	@if [ -f apps/api/cmd/migrate/main.go ]; then \
		docker compose run --rm -w /app/apps/api api go run ./cmd/migrate/main.go; \
	else \
		echo "Migration script not found at apps/api/cmd/migrate/main.go"; \
	fi

db-reset:
	@echo "Resetting database..."
	@if [ -f apps/api/cmd/migrate/main.go ]; then \
		docker compose run --rm -w /app/apps/api api go run ./cmd/migrate/main.go --reset; \
	else \
		echo "Migration script not found at apps/api/cmd/migrate/main.go"; \
	fi
