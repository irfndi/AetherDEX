#!/bin/bash

# AetherDEX Dependency Installation Script
# Installs all project dependencies using Bun, Go, and Forge

set -e  # Exit on any error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to print colored output
print_status() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Get script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

print_status "Starting dependency installation for AetherDEX..."
print_status "Project root: $PROJECT_ROOT"

# Check required tools
print_status "Checking required tools..."

if ! command -v pnpm >/dev/null 2>&1; then
    print_error "pnpm is not installed. Enable it via corepack or install globally:"
    print_error "  corepack enable pnpm"
    exit 1
fi

if ! command -v go >/dev/null 2>&1; then
    print_error "Go is not installed. Please install Go first:"
    print_error "  https://golang.org/doc/install"
    exit 1
fi

if ! command -v forge >/dev/null 2>&1; then
    print_error "Forge is not installed. Please install Foundry first:"
    print_error "  curl -L https://foundry.paradigm.xyz | bash"
    print_error "  foundryup"
    exit 1
fi

print_success "All required tools are available"

# Install JavaScript/TypeScript workspace dependencies (pnpm)
print_status "Installing workspace dependencies with pnpm..."
if [ -f "$PROJECT_ROOT/pnpm-workspace.yaml" ]; then
    cd "$PROJECT_ROOT"
    pnpm install
    print_success "Workspace dependencies installed"
else
    print_warning "pnpm-workspace.yaml not found in project root"
fi

# Install Backend dependencies (Go)
print_status "Installing backend dependencies with Go..."
if [ -d "$PROJECT_ROOT/backend" ]; then
    cd "$PROJECT_ROOT/backend"
    if [ -f "go.mod" ]; then
        go mod download
        go mod tidy
        print_success "Backend dependencies installed"
    else
        print_warning "No go.mod found in backend"
    fi
else
    print_warning "backend directory not found"
fi

# Install Smart Contract dependencies (Forge)
print_status "Installing smart contract dependencies with Forge..."
for contract_dir in "$PROJECT_ROOT/contracts" "$PROJECT_ROOT/backend/smart-contract"; do
    if [ -d "$contract_dir" ]; then
        cd "$contract_dir"
        if [ -f "foundry.toml" ]; then
            # Check if dependencies already exist
            if [ -d "lib" ] && [ "$(ls -A lib 2>/dev/null)" ]; then
                print_success "Smart contract dependencies already installed in $(basename "$contract_dir")"
            else
                forge install
                print_success "Smart contract dependencies installed in $(basename "$contract_dir")"
            fi
        else
            print_warning "No foundry.toml found in $contract_dir"
        fi
    fi
done

# Setup Go workspace
print_status "Setting up Go workspace..."
cd "$PROJECT_ROOT"
if [ -f "go.work" ]; then
    go work sync
    print_success "Go workspace synchronized"
fi

print_success "All dependencies installed successfully!"
print_status "Summary:"
print_status "  ✓ JavaScript/TypeScript workspace (pnpm)"
print_status "  ✓ Backend (Go)"
print_status "  ✓ Smart contracts (Forge)"
print_status "  ✓ Go workspace"

print_status "Next steps:"
print_status "  1. Copy .env.example to .env and configure environment variables"
print_status "  2. Run 'make dev' to start development servers"
print_status "  3. Check README.md for additional setup instructions"