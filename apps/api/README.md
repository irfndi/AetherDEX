# AetherDEX API

Cloudflare Workers backend for the AetherDEX lean spot DEX.

## Stack

- **Hono** — HTTP router on Workers fetch handler
- **Effect TS v3** — Business logic, error handling, dependency injection
- **D1** — Hot data (active pools, orders, users)
- **R2** — Trade history archives
- **Workers KV** — Hot cache (prices, sessions)
- **Durable Objects** — WebSocket state, per-pair order book
- **Queues** — Background job processing
- **Cron Triggers** — Scheduled tasks (price refresh every 5 min)

## Development

```bash
bun install
bun run dev      # Local Workers dev server
bun run test     # Vitest with @cloudflare/vitest-pool-workers
```

## Deployment

```bash
# First-time setup
bun run d1:create       # Create D1 database
bun run kv:create       # Create KV namespace
bun run r2:create       # Create R2 bucket
# Update wrangler.jsonc with returned IDs

# Environment-isolated resources
bun run d1:create:staging && bun run kv:create:staging && bun run r2:create:staging
bun run queues:create:staging
bun run d1:create:production && bun run kv:create:production && bun run r2:create:production
bun run queues:create:production

# Run migrations
bun run d1:migrate:local
bun run d1:migrate:remote  # Before deploy
bun run d1:migrate:staging
bun run d1:migrate:production

# Deploy
bun run deploy:staging
bun run deploy:production
```

## Contract bindings (Phase 4 — issue #314)

The non-secret contract addresses in `wrangler.jsonc` `vars` are filled from the
`packages/contracts` `Deploy.s.sol` deployment summary: `ROUTER_ADDRESS`, `FACTORY_ADDRESS`,
`POSITION_MANAGER_ADDRESS`, `V3_POSITION_MANAGER_ADDRESS`, `V3_EXECUTOR_ADDRESS`,
`POOL_MANAGER_ADDRESS`, `AETHER_HOOK_ADDRESS`, and the `TREASURY_ADDRESS` record. The treasury
multisig is **config, not a secret** — the fee accrues on-chain and the Worker never spends from it.

`AETHER_HOOK_ADDRESS` + `RPC_URL` are passed into the keeper queue env (`src/index.ts`); the
TP/SL worker (`src/workers/queue-handler.ts`) reads the on-chain AetherHook TWAP for trigger
gating and falls back to KV-cached prices when either is unset.

## Dependency notes (explicit exceptions)

The repo policy is "latest, always"; these pins are deliberate exceptions:

- **`jsbi@^3.2.5`** — must match `@uniswap/v3-sdk`'s JSBI major version. The quote-engine
  tests compose the canonical `SwapMath.computeSwapStep` primitive, which consumes and
  returns JSBI values; mixing JSBI v4 (incompatible class identity) with the SDK's v3
  values breaks the math interop.
- **`ethers@^5` + `@ethersproject/*`** (dev) — required ONLY by the Workers test pool.
  `siwe` and the Uniswap SDK barrels hard-import ethers v5 paths that workerd cannot
  link; `test/shims/ethers-worker-shim.ts` (aliased in `vitest.config.ts`) viem-backs
  those bare specifiers for tests, while production bundles the real packages via
  esbuild. Not a runtime dependency of the Worker.

## Architecture

See `AGENTS.md` for full architecture overview.
