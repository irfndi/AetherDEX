CONTRACTS_DIR = packages/contracts

# AetherDEX Development Makefile

.PHONY: help install test test-frontend test-backend test-integration test-coverage build clean dev lint format

# Default target
help:
	@echo "Available targets:"
	@echo "  install           - Install all dependencies"
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

# Install dependencies
install:
	@echo "Installing frontend dependencies..."
	cd apps/web && pnpm install
	@echo "Installing backend dependencies..."
	cd apps/api && go mod tidy
	@echo "Installing smart contract dependencies..."
	cd packages/contracts && forge install

# Test targets
test: test-frontend test-backend

test-frontend:
	@echo "Running frontend tests..."
	cd apps/web && pnpm test

test-backend:
	@echo "Running backend tests..."
	cd apps/api && go test ./... -v

test-integration:
	@echo "Running backend integration tests..."
	cd apps/api && INTEGRATION_TESTS=true go test -v -run TestAPIIntegrationSuite

test-coverage:
	@echo "Running frontend tests with coverage..."
	cd apps/web && pnpm vitest run --coverage
	@echo "Running backend tests with coverage..."
	cd apps/api && go test -coverprofile=coverage.out -covermode=atomic ./...
	go tool cover -html=apps/api/coverage.out -o apps/api/coverage.html
	@echo "Coverage reports generated: apps/web/coverage/ and apps/api/coverage.html"

# Build targets
build:
	@echo "Building frontend..."
	cd apps/web && pnpm build
	@echo "Building backend..."
	cd apps/api && go build -o bin/api cmd/api/main.go
	@echo "Building smart contracts..."
	cd packages/contracts && forge build

# Development targets
dev:
	@echo "Starting development servers..."
	@echo "Frontend: http://localhost:3000"
	@echo "Backend: http://localhost:8080"
	cd apps/web && pnpm dev &
	cd apps/api && go run cmd/api/main.go &
	wait

# Linting and formatting
lint:
	@echo "Linting frontend..."
	cd apps/web && pnpm lint
	@echo "Linting backend..."
	cd apps/api && go vet ./...
	@echo "Linting smart contracts..."
	cd packages/contracts && forge fmt --check

format:
	@echo "Formatting frontend..."
	cd apps/web && pnpm format
	@echo "Formatting backend..."
	cd apps/api && go fmt ./...
	@echo "Formatting smart contracts..."
	cd packages/contracts && forge fmt

# Clean targets
clean:
	@echo "Cleaning build artifacts..."
	cd apps/web && rm -rf .next dist node_modules/.cache
	cd apps/api && rm -rf bin/ *.out
	cd packages/contracts && forge clean

# Smart contract specific targets
contract-test:
	@echo "Running smart contract tests..."
	cd packages/contracts && forge test -vvv

contract-deploy-local:
	@echo "Deploying contracts to local network..."
	cd packages/contracts && forge script script/Deploy.s.sol --rpc-url http://localhost:8545 --broadcast

# Performance testing
test-performance:
	@echo "Running performance tests..."
	@cd apps/web && pnpm vitest run __tests__/performance.test.tsx
	@cd apps/api && PERFORMANCE_TESTS=true go test -v -run TestPerformanceTestSuite ./...

test-performance-frontend:
	@echo "Running frontend performance tests..."
	@cd apps/web && pnpm vitest run __tests__/performance.test.tsx

test-performance-backend:
	@echo "Running backend performance tests..."
	@cd apps/api && PERFORMANCE_TESTS=true go test -v -run TestPerformanceTestSuite ./...

# Benchmark tests
bench:
	@echo "Running benchmark tests..."
	@cd apps/api && go test -bench=. -benchmem -run=^$

bench-frontend:
	@echo "Running frontend benchmarks..."
	@cd apps/web && pnpm vitest bench __tests__/performance.test.tsx

bench-backend:
	@echo "Running backend benchmarks..."
	@cd apps/api && go test -bench=. -benchmem -run=^$

perf-test:
	@echo "Running performance tests..."
	cd apps/web && pnpm vitest run __tests__/performance.test.tsx

# Database operations
db-migrate:
	@echo "Running database migrations..."
	cd apps/api && go run cmd/migrate/main.go

db-reset:
	@echo "Resetting database..."
	cd apps/api && go run cmd/migrate/main.go --reset