/**
 * AetherDEX Cron Handlers
 * Scheduled tasks (every 5 minutes per wrangler.jsonc):
 * - Refresh pool TVL/volume from on-chain
 * - Enqueue price refresh for top tokens
 * - Cleanup expired sessions
 */

import { Effect } from "effect"

interface CronEnv {
  DB: D1Database
  CACHE: KVNamespace
  STORAGE: R2Bucket
  PRICE_QUEUE: Queue
  SETTLE_QUEUE: Queue
  CHAIN_ID: string
}

/**
 * Scheduled task — runs every 5 minutes
 */
export const handleScheduled = async (
  event: ScheduledEvent,
  env: CronEnv,
  ctx: ExecutionContext,
): Promise<void> => {
  const cron = event.cron
  console.log(`Cron triggered: ${cron} at ${new Date(event.scheduledTime).toISOString()}`)

  ctx.waitUntil(
    Effect.runPromise(
      Effect.gen(function* () {
        yield* Effect.tryPromise({
          try: () => refreshTopPools(env),
          catch: (e) => new Error(`Pool refresh failed: ${String(e)}`),
        })
      }),
    ).catch((err) => console.error("Cron error:", err)),
  )

  ctx.waitUntil(
    Effect.runPromise(
      Effect.gen(function* () {
        yield* Effect.tryPromise({
          try: () => enqueuePriceRefresh(env),
          catch: (e) => new Error(`Price enqueue failed: ${String(e)}`),
        })
      }),
    ).catch((err) => console.error("Cron price enqueue error:", err)),
  )
}

async function refreshTopPools(env: CronEnv): Promise<void> {
  console.log("Refreshing top pools from on-chain")

  // Get top 50 active pools from D1
  const pools = await env.DB.prepare(
    `SELECT pool_id, token0_address, token1_address FROM pools
     WHERE is_active = 1 ORDER BY tvl_usd DESC LIMIT 50`,
  ).all<{ pool_id: string; token0_address: string; token1_address: string }>()

  if (!pools.results) return

  // Enqueue a price-refresh message for each pool's tokens
  const tokenAddresses = new Set<string>()
  for (const pool of pools.results) {
    tokenAddresses.add(pool.token0_address)
    tokenAddresses.add(pool.token1_address)
  }

  if (tokenAddresses.size > 0) {
    await env.PRICE_QUEUE.send({
      type: "price-refresh",
      tokens: Array.from(tokenAddresses),
    })
  }

  console.log(`Refreshed ${pools.results.length} pools, ${tokenAddresses.size} tokens queued`)
}

async function enqueuePriceRefresh(env: CronEnv): Promise<void> {
  // Refresh verified tokens every 5 minutes
  const tokens = await env.DB.prepare(
    `SELECT address FROM tokens WHERE is_verified = 1 LIMIT 200`,
  ).all<{ address: string }>()

  if (!tokens.results || tokens.results.length === 0) return

  // Split into batches of 50 (per queue message limit)
  for (let i = 0; i < tokens.results.length; i += 50) {
    const batch = tokens.results.slice(i, i + 50).map((t) => t.address)
    await env.PRICE_QUEUE.send({
      type: "price-refresh",
      tokens: batch,
    })
  }

  console.log(`Enqueued price refresh for ${tokens.results.length} tokens`)
}
