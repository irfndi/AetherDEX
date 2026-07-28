# AetherDEX Deployment Guide

## Prerequisites

- Bun 1.4.0-canary or later
- Foundry (forge, cast, anvil)
- Cloudflare account with Workers, Pages, D1, R2, KV, Durable Objects enabled
- Reown AppKit project ID (https://cloud.reown.com)
- Etherscan API key (for contract verification)
- Sepolia ETH for testnet deployment

## Smart Contracts (Sepolia Testnet)

```bash
cd packages/contracts
cp .env.example .env
# Edit .env: set DEPLOYER_PRIVATE_KEY, AETHERDEX_TREASURY, ETHERSCAN_API_KEY

# Deploy to Sepolia (the current supported crypto test network)
forge script script/Deploy.s.sol --rpc-url sepolia --broadcast --verify

# Verify before wiring the addresses into Workers
AETHERDEX_ROUTER=0x... AETHERDEX_HOOK=0x... AETHERDEX_TREASURY=0x... \
  forge script script/Verify.s.sol --rpc-url sepolia

# Verify on Etherscan (automatic with --verify)
```

### Expected Addresses (Sepolia)

| Contract | Address |
|----------|---------|
| PoolManager (Uniswap V4) | `0xE03A1074c86CFeDd5C142C4F04F1a1536e203543` |
| AetherHook | (deployed) |
| AetherFactory | (deployed) |
| AetherRouter | (deployed) |

## Backend (Cloudflare Workers)

There are three different environments:

- `wrangler dev` is local development. It uses local D1/KV emulation and does not
  deploy anything or execute against a public chain unless `RPC_URL` is configured.
- `--env staging` is a real Cloudflare Worker with separate D1/KV/R2/Queue/DO
  resources. Point its `CHAIN_ID`, `RPC_URL`, and contract-address vars at Sepolia
  to use it as the shared crypto test environment.
- `--env production` is the production Worker. Do not point it at a test wallet or
  test contracts.

The repository currently has no deployed staging resource IDs or contract addresses:
`wrangler.jsonc` still contains `REPLACE_WITH_OUTPUT...` placeholders and empty
address/RPC vars. Deployment is therefore not yet reproducible from CI until an
operator provisions those resources and records the IDs in the environment config.

### First-time setup

```bash
cd apps/api

# Create default development resources
bun run d1:create
bun run kv:create
bun run r2:create

# Create isolated staging resources
bun run d1:create:staging
bun run kv:create:staging
bun run r2:create:staging
bun run queues:create:staging

# Create isolated production resources
bun run d1:create:production
bun run kv:create:production
bun run r2:create:production
bun run queues:create:production

# Copy each command's returned D1 database_id and KV id into the matching
# staging/production blocks in wrangler.jsonc. Do not reuse IDs across environments.

# Run migrations
bun run d1:migrate:local
bun run d1:migrate:remote
bun run d1:migrate:staging
bun run d1:migrate:production

# Apply staging migrations, then deploy the Worker
bun run deploy:staging

# Deploy to production
bun run deploy:production
```

### Secrets to set

```bash
# Production secrets
bunx wrangler secret put KEEPER_PRIVATE_KEY --env staging
bunx wrangler secret put KEEPER_RPC_URL --env staging
# Optional: Telegram alert secrets and private relay secrets, only when enabled.

# Alchemy is an RPC/provider option, not the infrastructure owner. Set its URL/API
# key as a Worker secret or RPC_URL value if selected; Cloudflare still owns the
# Worker, D1, KV, R2, DO, and Queue resources.
```

## Frontend (Cloudflare Pages)

### First-time setup

```bash
cd apps/web

# Set env vars in Cloudflare Pages dashboard:
#   VITE_API_URL = https://api.aetherdex.io/api/v1
#   VITE_REOWN_PROJECT_ID = your_actual_project_id

# Build
bun run build

# Deploy
bun run deploy
```

## Post-deployment checklist

- [ ] Contracts verified on Etherscan
- [ ] D1 migrations applied to production
- [ ] KV namespace configured
- [ ] R2 bucket created
- [ ] Workers deployed with secrets
- [ ] Pages deployed with env vars
- [ ] Test swap end-to-end on testnet
- [ ] Monitor Workers analytics dashboard
- [ ] Set up uptime monitoring (T30)
