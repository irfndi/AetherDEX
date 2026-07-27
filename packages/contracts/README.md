# AetherDEX Smart Contracts

A lean spot DEX built on Uniswap V4.

## Architecture

- **AetherHook**: Oracle-only V4 hook recording a v3-style TWAP (pool-state tick) observation buffer for keeper-safe TP/SL. Phase 4: protocol fee admin/accrual removed — the hook holds no funds and has no owner
- **AetherRouter**: User-facing router (swap, zap, and compatibility add/remove liquidity). Charges a flat, immutable 0.1% protocol ENTRY fee on liquidity deposits (addLiquidity / addLiquiditySingleSided), transferred directly to the immutable treasury; swaps, removals, rebalance, and TP/SL stay fee-free
- **AetherPositionManager**: ERC721 receipt manager for transferable, owner-authorized V4 positions
- **AetherFactory**: Deterministic pool deploys via CREATE2

## Stack

- Solidity 0.8.36 (no Vyper — dropped for simpler audit surface)
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
├── position/      # ERC721 receipt-position manager
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
