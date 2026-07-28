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
- `bun run plan:dev` in `infra/alchemy/` previews the development stack.
- `bun run deploy:dev` and `bun run deploy:staging` in `infra/alchemy/` deploy
  separate Cloudflare Workers with separate D1/KV/R2/Queue/DO resources.
- `--adopt` allows Alchemy to take ownership of matching existing resources; it
  does not select unrelated resources by type.
- Set `CHAIN_ID`, `RPC_URL`, and the deployed contract-address variables in
  `infra/alchemy/.env` to use Sepolia as the shared crypto test environment.
- Production deployment is not enabled by the current Alchemy script. Do not
  point a test wallet or test contracts at production.

`infra/alchemy/alchemy.run.ts` is the deployment source of truth. The legacy
`apps/api/wrangler.jsonc` remains useful for local Wrangler commands and type
generation, but its placeholder resource IDs are not used by the Alchemy
deployment path.

### First-time setup

```bash
cd infra/alchemy
cp .env.example .env
# Edit .env with the Sepolia RPC URL and deployed contract addresses.
bun install
bun run plan:dev
bun run deploy:dev
bun run deploy:staging
```

### Secrets to set

```bash
# Secrets are added to the Worker through the chosen Alchemy/Cloudflare secret
# workflow after the non-secret stack has been deployed.
# Do not commit private keys or RPC API keys.
# Optional: Telegram alert secrets and private relay secrets, only when enabled.

# Alchemy provisions the Cloudflare resources in this repository. Alchemy's RPC
# endpoint is a network dependency, so its URL/API key belongs in the uncommitted
# Alchemy environment or a Worker secret.
```

## Frontend (Cloudflare Pages)

No Pages project currently exists in the account. Frontend Pages provisioning is
not part of the current API stack; add it to Alchemy before deploying the web
application so the API and frontend remain under one deployment source of truth.

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
