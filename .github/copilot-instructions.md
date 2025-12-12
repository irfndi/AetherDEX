# Copilot Agent Instructions

This file configures the GitHub Copilot coding agent environment for the AetherDEX repository.

## Project Overview

AetherDEX is a decentralized exchange (DEX) project with:
- **Frontend**: Vite + React application in `apps/web/`
- **Smart Contracts**: Solidity contracts using Foundry in `packages/contracts/`
- **Backend Services**: Go backend in `apps/api/`

## Development Guidelines

### Frontend (apps/web/)
- Use Bun as the package manager
- Follow TypeScript best practices
- Use Biome or Oxlint for linting
- Test with Vitest

### Smart Contracts (packages/contracts/)
- Use Foundry for development and testing
- Follow Solidity best practices
- Write comprehensive tests

### Backend (apps/api/)
- Use Go modules
- Follow Go idioms and best practices

## Network Access

The Copilot agent requires network access to the following domains for dependency management and development:

### NPM Registry
- registry.npmjs.org
- registry.yarnpkg.com

### GitHub
- api.github.com
- github.com
- raw.githubusercontent.com

### Package Managers
- bun.sh

### Security Services
- socket.dev (for dependency security scanning)
