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
    cd backend && go mod tidy
    @echo "Installing smart contract dependencies..."
    cd backend/smart-contract && forge install

# Test targets
test: test-frontend test-backend

test-frontend:
    @echo "Running frontend tests..."
    cd apps/web && pnpm test

test-backend:
    @echo "Running backend tests..."
    cd backend && go test ./... -v

test-integration:
    @echo "Running backend integration tests..."
    cd backend && INTEGRATION_TESTS=true go test -v -run TestAPIIntegrationSuite

test-coverage:
    @echo "Running frontend tests with coverage..."
    cd apps/web && pnpm vitest run --coverage
    @echo "Running backend tests with coverage..."
    cd backend && go test -coverprofile=coverage.out -covermode=atomic ./...
    go tool cover -html=backend/coverage.out -o backend/coverage.html
    @echo "Coverage reports generated: apps/web/coverage/ and backend/coverage.html"

# Build targets
build:
    @echo "Building frontend..."
    cd apps/web && pnpm build
    @echo "Building backend..."
    cd backend && go build -o bin/api cmd/api/main.go
    @echo "Building smart contracts..."
    cd backend/smart-contract && forge build

# Development targets
dev:
    @echo "Starting development servers..."
    @echo "Frontend: http://localhost:3000"
    @echo "Backend: http://localhost:8080"
    cd apps/web && pnpm dev &
    cd backend && go run cmd/api/main.go &
    wait

# Linting and formatting
lint:
    @echo "Linting frontend..."
    cd apps/web && pnpm lint
    @echo "Linting backend..."
    cd backend && go vet ./...
    @echo "Linting smart contracts..."
    cd backend/smart-contract && forge fmt --check

format:
    @echo "Formatting frontend..."
    cd apps/web && pnpm format
    @echo "Formatting backend..."
    cd backend && go fmt ./...
    @echo "Formatting smart contracts..."
    cd backend/smart-contract && forge fmt

# Clean targets
clean:
    @echo "Cleaning build artifacts..."
    cd apps/web && rm -rf .next dist node_modules/.cache
    cd backend && rm -rf bin/ *.out
    cd backend/smart-contract && forge clean

# Smart contract specific targets
contract-test:
    @echo "Running smart contract tests..."
    cd backend/smart-contract && forge test -vvv

contract-deploy-local:
    @echo "Deploying contracts to local network..."
    cd backend/smart-contract && forge script script/Deploy.s.sol --rpc-url http://localhost:8545 --broadcast

# Performance testing
test-performance:
    @echo "Running performance tests..."
    @cd apps/web && pnpm vitest run __tests__/performance.test.tsx
    @cd backend && PERFORMANCE_TESTS=true go test -v -run TestPerformanceTestSuite ./...

test-performance-frontend:
    @echo "Running frontend performance tests..."
    @cd apps/web && pnpm vitest run __tests__/performance.test.tsx

test-performance-backend:
    @echo "Running backend performance tests..."
    @cd backend && PERFORMANCE_TESTS=true go test -v -run TestPerformanceTestSuite ./...

# Benchmark tests
bench:
    @echo "Running benchmark tests..."
    @cd backend && go test -bench=. -benchmem -run=^$

bench-frontend:
    @echo "Running frontend benchmarks..."
    @cd apps/web && pnpm vitest bench __tests__/performance.test.tsx

bench-backend:
    @echo "Running backend benchmarks..."
    @cd backend && go test -bench=. -benchmem -run=^$

perf-test:
    @echo "Running performance tests..."
    cd apps/web && pnpm vitest run __tests__/performance.test.tsx

# Database operations
db-migrate:
    @echo "Running database migrations..."
    cd backend && go run cmd/migrate/main.go

db-reset:
    @echo "Resetting database..."
    cd backend && go run cmd/migrate/main.go --reset