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

# Deploy
forge script script/Deploy.s.sol --rpc-url sepolia --broadcast --verify

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

### First-time setup

```bash
cd apps/api

# Create D1 database
bun run d1:create
# Copy the database_id output into wrangler.jsonc

# Create KV namespace
bun run kv:create
# Copy the id output into wrangler.jsonc

# Create R2 bucket
bun run r2:create

# Run migrations
bun run d1:migrate:local
bun run d1:migrate:remote

# Deploy to staging
bun run deploy:staging

# Deploy to production
bun run deploy:production
```

### Secrets to set

```bash
# Production secrets
bunx wrangler secret put ALCHEMY_API_KEY --env production
bunx wrangler secret put CLOUDFLARE_API_TOKEN --env production
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
