#!/bin/bash

# AetherDEX Dependency Update Script
# Updates all project dependencies using Bun, Go, and Forge

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

print_status "Starting dependency updates for AetherDEX..."
print_status "Project root: $PROJECT_ROOT"

# Update JS/TS workspace (pnpm)
print_status "Updating JavaScript/TypeScript workspace dependencies with pnpm..."
if [ -f "$PROJECT_ROOT/pnpm-workspace.yaml" ]; then
    if command -v pnpm >/dev/null 2>&1; then
        cd "$PROJECT_ROOT"
        pnpm install
        pnpm update -r
        print_success "Workspace dependencies updated"
    else
        print_error "pnpm is not installed. Use 'corepack enable pnpm' or install pnpm globally."
        exit 1
    fi
else
    print_warning "pnpm-workspace.yaml not found in project root"
fi

# Update Backend (Go)
print_status "Updating backend dependencies with Go..."
if [ -d "$PROJECT_ROOT/backend" ]; then
    cd "$PROJECT_ROOT/backend"
    if [ -f "go.mod" ]; then
        if command -v go >/dev/null 2>&1; then
            go mod tidy
            go get -u ./...
            print_success "Backend dependencies updated"
        else
            print_error "Go is not installed. Please install Go first."
            exit 1
        fi
    else
        print_warning "No go.mod found in backend"
    fi
else
    print_warning "backend directory not found"
fi

# Update Smart Contracts (Forge)
print_status "Updating smart contract dependencies with Forge..."
for contract_dir in "$PROJECT_ROOT/contracts" "$PROJECT_ROOT/backend/smart-contract"; do
    if [ -d "$contract_dir" ]; then
        cd "$contract_dir"
        if [ -f "foundry.toml" ]; then
            if command -v forge >/dev/null 2>&1; then
                forge update
                print_success "Smart contract dependencies updated in $(basename "$contract_dir")"
            else
                print_error "Forge is not installed. Please install Foundry first."
                exit 1
            fi
        else
            print_warning "No foundry.toml found in $contract_dir"
        fi
    fi
done

# Update Go workspace
print_status "Updating Go workspace..."
cd "$PROJECT_ROOT"
if [ -f "go.work" ]; then
    if command -v go >/dev/null 2>&1; then
        go work sync
        print_success "Go workspace updated"
    fi
fi

print_success "All dependency updates completed successfully!"
print_status "Summary:"
print_status "  ✓ JavaScript/TypeScript workspace (pnpm)"
print_status "  ✓ Backend (Go)"
print_status "  ✓ Smart contracts (Forge)"
print_status "  ✓ Go workspace"