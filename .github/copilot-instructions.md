# Copilot Instructions for AetherDEX

## Overview

AetherDEX is a decentralized exchange (DEX) with concentrated liquidity and advanced DeFi features, built on Ethereum and compatible L2 networks.

## Repository Structure

This is a monorepo with the following components:

```
AetherDEX/
├── backend/
│   └── smart-contract/     # Solidity smart contracts (Foundry)
├── interface/
│   └── web/                # Next.js web interface
├── docs/                   # Documentation
└── scripts/                # Utility scripts
```

## Tech Stack

### Smart Contracts (`backend/smart-contract/`)

- **Language**: Solidity 0.8.29
- **Framework**: Foundry (forge, cast, anvil)
- **Testing**: Foundry test framework with fuzz testing
- **Dependencies**: OpenZeppelin Contracts, Uniswap v4-core
- **Compiler Settings**: Optimizer enabled (1000 runs), via-ir enabled

### Frontend (`interface/web/`)

- **Framework**: Next.js 16
- **Language**: TypeScript 5.x
- **Package Manager**: Bun (preferred) or npm
- **Styling**: Tailwind CSS 4.x
- **UI Components**: Radix UI primitives, shadcn/ui patterns
- **Web3**: wagmi, viem, Web3Modal
- **Linter/Formatter**: Biome

## Development Commands

### Smart Contracts

```bash
cd backend/smart-contract

# Install dependencies
forge install

# Build contracts
forge build

# Run tests
forge test -vvv

# Run tests with gas reporting
forge test --gas-report

# Format code
forge fmt

# Generate coverage report
forge coverage --report lcov
```

### Frontend

```bash
cd interface/web

# Install dependencies
bun install

# Start development server
bun dev

# Build for production
bun run build

# Run linting
bun run lint

# Format code
bun run format
```

## Code Style and Conventions

### Solidity

- Follow the [Solidity Style Guide](https://docs.soliditylang.org/en/latest/style-guide.html)
- Use NatSpec comments for all public/external functions
- Use meaningful variable and function names
- Maximum line length: 120 characters (configured in foundry.toml)
- Prefer explicit visibility modifiers
- Use custom errors instead of require strings for gas efficiency

### TypeScript/React

- Use functional components with hooks
- Follow React naming conventions (PascalCase for components)
- Use TypeScript strict mode
- Prefer `interface` over `type` for object shapes
- Use Biome for consistent formatting

## Testing Guidelines

### Smart Contract Tests

- Write unit tests for all public functions
- Include fuzz tests for functions with numeric inputs
- Test edge cases and failure conditions
- Use descriptive test names: `test_FunctionName_Description`
- Group related tests in separate test files

### Frontend Tests

- Test component rendering and user interactions
- Mock Web3 providers for blockchain interactions
- Use React Testing Library patterns

## Security Considerations

### Do Not Modify

- Never commit private keys or secrets
- Do not modify `.env` files with actual credentials
- Avoid changes to security-critical audit configurations
- Do not disable security checks in CI workflows

### Smart Contract Security

- Always validate inputs in external/public functions
- Use reentrancy guards where appropriate
- Follow checks-effects-interactions pattern
- Use SafeERC20 for token transfers
- Consider oracle manipulation risks in price-dependent logic

## Architecture Notes

### Smart Contracts

- **AetherPool**: Core AMM logic with concentrated liquidity
- **AetherFactory**: Pool deployment and management
- **AetherRouter**: User-facing swap and liquidity operations
- **TWAP Oracle**: Time-weighted average price calculations
- **Hooks**: Extensible pre/post-swap operations

### Frontend

- Uses App Router (Next.js 13+ conventions)
- Components follow shadcn/ui patterns
- Web3 state managed via wagmi hooks
- Theme support via next-themes

## CI/CD

- **Foundry Tests**: Runs on push/PR to main, master, develop
- **Frontend Build**: Runs on push/PR to main, develop
- **CodeQL**: Security scanning enabled

## Pull Request Guidelines

1. Create feature branches from `develop`
2. Write descriptive commit messages
3. Include tests for new functionality
4. Ensure all CI checks pass
5. Request review before merging
