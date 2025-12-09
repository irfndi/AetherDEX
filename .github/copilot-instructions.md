# Copilot Agent Instructions

This file configures the GitHub Copilot coding agent environment for the AetherDEX repository.

## Project Overview

AetherDEX is a decentralized exchange (DEX) project with:
- **Frontend**: Next.js application in `apps/web/`
- **Smart Contracts**: Solidity contracts using Foundry in `backend/smart-contract/`
- **Backend Services**: Go backend in `backend/`

## Development Guidelines

### Frontend (apps/web/)
- Use Bun as the package manager
- Follow TypeScript best practices
- Use Biome for linting and formatting
- Test with Vitest

### Smart Contracts (backend/smart-contract/)
- Use Foundry for development and testing
- Follow Solidity best practices
- Write comprehensive tests

### Backend (backend/)
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
