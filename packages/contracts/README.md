# AetherDEX Smart Contracts

A lean spot DEX built on Uniswap V4.

## Architecture

- **AetherHook**: Custom V4 hook for fee override and TWAP
- **AetherRouter**: User-facing router (swap, add/remove liquidity)
- **AetherFactory**: Deterministic pool deploys via CREATE2

## Stack

- Solidity 0.8.31 (no Vyper — dropped for simpler audit surface)
- Foundry (forge, cast, anvil)
- Uniswap V4-core (vendored at lib/v4-core)
- OpenZeppelin v5

## Commands

```bash
forge build          # Compile
forge test           # Run tests
forge coverage       # Coverage report (target >90%)
forge fmt            # Format
forge script script/Deploy.s.sol --rpc-url sepolia --broadcast  # Deploy to Sepolia
```

## Layout

```
src/
├── hook/          # V4 hooks
├── router/        # User-facing router
├── factory/       # Pool factory
├── lib/           # Shared libraries (Errors)
├── types/         # Type definitions
└── interfaces/    # Contract interfaces

test/
├── unit/          # Unit tests
├── integration/   # Integration tests
└── fuzz/          # Fuzz tests

script/            # Deployment scripts
```

## Security

- Test coverage target: >90%
- Slither static analysis in CI
- Echidna fuzzing (planned)
- Audit required before mainnet deployment
