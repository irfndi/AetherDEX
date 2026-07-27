/**
 * AetherDEX Cron Handlers
 * Scheduled tasks (every 5 minutes per wrangler.jsonc):
 * - Refresh pool TVL/volume from on-chain
 * - Enqueue price refresh for top tokens
 * - Cleanup expired sessions
 */

import { Effect } from "effect"
import { makeDbLayer } from "../db/client"
import { getIndexerCursor, setIndexerCursor } from "../db/queries"
import { parseChainId } from "../lib/chain-id"
import { runEffect } from "../lib/effect-bridge"
import { V3LiquidityIndexer, V3LiquidityIndexerLive } from "../services/v3-liquidity-indexer.service"
import { finalizedV3Head, nextV3IndexerRange, V3_INDEXER_NAME } from "./v3-indexer-cursor"

interface CronEnv {
  DB: D1Database
  CACHE: KVNamespace
  STORAGE: R2Bucket
  PRICE_QUEUE: Queue
  SETTLE_QUEUE: Queue
  CHAIN_ID: string
  RPC_URL?: string
  V3_POSITION_MANAGER_ADDRESS?: string
  V3_POSITION_MANAGER_DEPLOYMENT_BLOCK?: string
}

/**
 * Scheduled task — runs every 5 minutes
 */
export const handleScheduled = async (event: ScheduledEvent, env: CronEnv, ctx: ExecutionContext): Promise<void> => {
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

  ctx.waitUntil(runV3LiquidityIndexer(env).catch((err) => console.error("Cron v3 indexer error:", err)))
}

async function runV3LiquidityIndexer(env: CronEnv): Promise<void> {
  const chainId = parseChainId(env.CHAIN_ID)
  if (chainId === null || !env.RPC_URL || !env.V3_POSITION_MANAGER_ADDRESS) return

  const indexerLayer = V3LiquidityIndexerLive({
    chainId,
    rpcUrl: env.RPC_URL,
    positionManager: env.V3_POSITION_MANAGER_ADDRESS as `0x${string}`,
    pools: [],
  })

  await runEffect(
    Effect.gen(function* () {
      const indexer = yield* V3LiquidityIndexer
      const latestBlock = finalizedV3Head(yield* indexer.latestBlock)
      const cursor = yield* getIndexerCursor(chainId, V3_INDEXER_NAME)
      const deploymentBlock = BigInt(env.V3_POSITION_MANAGER_DEPLOYMENT_BLOCK ?? "0")
      const range = nextV3IndexerRange(cursor, latestBlock, deploymentBlock)
      if (!range) return
      yield* indexer.indexRange(range.fromBlock, range.toBlock)
      yield* setIndexerCursor(chainId, V3_INDEXER_NAME, range.toBlock + 1n)
    }).pipe(Effect.provide(indexerLayer), Effect.provide(makeDbLayer(env.DB))),
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
  // Refresh verified tokens every 5 minutes — scoped to this chain: tokens are keyed
  // by (chain_id, address) and another chain's tokens must not be refreshed here.
  const chainId = Number.parseInt(env.CHAIN_ID, 10)
  const tokens = await env.DB.prepare("SELECT address FROM tokens WHERE is_verified = 1 AND chain_id = ? LIMIT 200")
    .bind(Number.isNaN(chainId) ? 1 : chainId)
    .all<{
      address: string
    }>()

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
