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
  AETHERDEX_HOOK_CODE_HASH=0x... \
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
- Set `CHAIN_ID`, `RPC_URL`, `AETHERDEX_*` contract-address variables,
  `STATE_VIEW_ADDRESS`, `V3_FACTORY_ADDRESS`, and `V3_QUOTER_ADDRESS` in
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
# Edit .env with the Sepolia RPC URL, deployed contract addresses, and
# VITE_API_URL/VITE_REOWN_PROJECT_ID for the local Pages upload.
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

Alchemy provisions the `aetherdex-web-dev` and `aetherdex-web-staging` Pages
projects. The Alchemy Pages provider manages the project/build configuration;
the static asset upload uses the documented Wrangler command because the
provider does not currently upload Pages assets.

### First-time setup

```bash
cd apps/web

# `web:deploy:*` injects these at Vite build time; Pages dashboard variables
# cannot change an already-built bundle.
#   VITE_API_URL = https://<worker>/api/v1
#   VITE_REOWN_PROJECT_ID = your_actual_project_id
#   VITE_WS_URL = https://<worker> (optional; derived from VITE_API_URL)

# Build
bun run build

# Deploy the asset bundle to the Alchemy-provisioned project
cd ../../infra/alchemy
bun run web:deploy:staging
```

The dev upload targets the `dev` Pages production branch and staging targets
`main`; this keeps the stable `pages.dev` URLs distinct from previews.

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
