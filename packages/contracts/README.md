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

## Deployment (Phase 4 — issue #314)

`script/Deploy.s.sol` is env-driven so the same script deploys to Sepolia (default) or
Robinhood Chain (and any future Uniswap-v4 network). `script/Verify.s.sol` is a read-only
post-deploy gate for the immutable Phase-4 shape.

| Env var | Required | Notes |
| --- | --- | --- |
| `DEPLOYER_PRIVATE_KEY` | yes | broadcast EOA; also the CREATE2 hook deployer |
| `AETHERDEX_TREASURY` | yes | fee treasury multisig — **config, not a secret** |
| `POOL_MANAGER` | no | target network's V4 PoolManager (defaults to canonical Sepolia) |
| `NETWORK_NAME` | no | label echoed in the summary (default `Sepolia`) |
| `AETHERDEX_PROTOCOL_FEE_BPS` | no | entry fee in bps (default `10` = locked 0.1%) |
| `AETHERDEX_HOOK` / `AETHERDEX_FACTORY` / `AETHERDEX_ROUTER` / `AETHERDEX_POSITION_MANAGER` | no | reuse an already-deployed contract instead of redeploying |

```bash
# Deploy (Sepolia)
DEPLOYER_PRIVATE_KEY=0x.. AETHERDEX_TREASURY=0x.. \
  forge script script/Deploy.s.sol --rpc-url sepolia --broadcast --verify

# Deploy (Robinhood Chain) — TODO(#314): supply the network's POOL_MANAGER + RPC alias
DEPLOYER_PRIVATE_KEY=0x.. AETHERDEX_TREASURY=0x.. POOL_MANAGER=0x.. NETWORK_NAME=RobinhoodChain \
  forge script script/Deploy.s.sol --rpc-url <robinhood-rpc> --broadcast --verify

# Verify the deployed immutable shape (read-only): asserts router PROTOCOL_FEE_BPS()==10,
# treasury/wiring, and the audited oracle-only hook runtime code hash.
AETHERDEX_ROUTER=0x.. AETHERDEX_HOOK=0x.. AETHERDEX_TREASURY=0x.. \
  AETHERDEX_HOOK_CODE_HASH=0x.. \
  forge script script/Verify.s.sol --rpc-url <target>
```

The Deployment Summary logged by `Deploy.s.sol` is the source for the `apps/api` contract
bindings (`ROUTER_ADDRESS`, `FACTORY_ADDRESS`, `AETHER_HOOK_ADDRESS`, `POSITION_MANAGER_ADDRESS`,
`POOL_MANAGER_ADDRESS`, `TREASURY_ADDRESS`). Post-#315 the protocol fee is an **immutable 0.1%
router entry fee** (`AetherRouter.PROTOCOL_FEE_BPS == 10`, immutable treasury) and `AetherHook`
is oracle-only — the exact shape `Deploy.s.sol` constructs and `Verify.s.sol` gates.

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
