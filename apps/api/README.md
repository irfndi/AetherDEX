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

# Run migrations
bun run d1:migrate:local
bun run d1:migrate:remote  # Before deploy

# Deploy
bun run deploy:staging
bun run deploy:production
```

## Architecture

See `AGENTS.md` for full architecture overview.
