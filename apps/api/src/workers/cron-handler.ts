/**
 * AetherDEX Cron Handlers — Phase 2 Extended
 * Scheduled tasks (every 5 minutes per wrangler.jsonc):
 * - Refresh pool TVL/volume from on-chain
 * - Enqueue price refresh for top tokens
 * - Cleanup expired sessions
 * - **NEW: Keeper tick — evaluate TP/SL triggers and auto-recenter**
 */

import { Effect } from "effect"

interface CronEnv {
  DB: D1Database
  CACHE: KVNamespace
  STORAGE: R2Bucket
  PRICE_QUEUE: Queue
  SETTLE_QUEUE: Queue
  KEEPER_QUEUE: Queue
  CHAIN_ID: string
}

/**
 * Scheduled task — runs every 5 minutes
 */
export const handleScheduled = async (event: ScheduledEvent, env: CronEnv, ctx: ExecutionContext): Promise<void> => {
  const cron = event.cron
  console.log(`Cron triggered: ${cron} at ${new Date(event.scheduledTime).toISOString()}`)

  // Existing: refresh pools + prices
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

  // NEW: Keeper tick — evaluate TP/SL triggers and auto-recenter
  ctx.waitUntil(
    Effect.runPromise(
      Effect.gen(function* () {
        yield* Effect.tryPromise({
          try: () => runKeeperTick(env),
          catch: (e) => new Error(`Keeper tick failed: ${String(e)}`),
        })
      }),
    ).catch((err) => console.error("Cron keeper tick error:", err)),
  )
}

/**
 * Keeper tick — evaluates pending TP/SL orders and queues execution jobs.
 * Runs every 5 minutes via cron. The actual execution happens in the queue handler
 * where the keeper has time to sign and submit transactions.
 */
async function runKeeperTick(env: CronEnv): Promise<void> {
  const chainId = Number.parseInt(env.CHAIN_ID, 10) || 11155111
  const now = Date.now()

  console.log(`[Keeper] Tick started for chain ${chainId}`)

  // 1. Find pending TP/SL orders that haven't expired
  const pendingOrders = await env.DB.prepare(`
    SELECT id, pool_id, order_type, zero_for_one, amount_in, min_amount_out,
           trigger_price_x18, twap_window, slippage_bps, deadline, user_address
    FROM tp_sl_orders
    WHERE chain_id = ? AND status = 'pending' AND deadline > ?
    ORDER BY created_at ASC
    LIMIT 50
  `)
    .bind(chainId, now)
    .all<{
      id: number
      pool_id: string
      order_type: string
      zero_for_one: number
      amount_in: string
      min_amount_out: string
      trigger_price_x18: string
      twap_window: number
      slippage_bps: number
      deadline: number
      user_address: string
    }>()

  if (!pendingOrders.results || pendingOrders.results.length === 0) {
    console.log("[Keeper] No pending orders to evaluate")
    return
  }

  console.log(`[Keeper] Evaluating ${pendingOrders.results.length} pending orders`)

  // 2. Enqueue each order for evaluation + potential execution
  for (const order of pendingOrders.results) {
    try {
      await env.KEEPER_QUEUE.send({
        type: "tp-sl-evaluate",
        orderId: order.id,
        poolId: order.pool_id,
        orderType: order.order_type,
        zeroForOne: Boolean(order.zero_for_one),
        amountIn: order.amount_in,
        minAmountOut: order.min_amount_out,
        triggerPriceX18: order.trigger_price_x18,
        twapWindow: order.twap_window,
        slippageBps: order.slippage_bps,
        deadline: order.deadline,
        userAddress: order.user_address,
        chainId,
      })
    } catch (error) {
      console.error(`[Keeper] Failed to enqueue order ${order.id}:`, error)
    }
  }

  // 3. Check for expired orders and mark them
  const expiredResult = await env.DB.prepare(`
    UPDATE tp_sl_orders
    SET status = 'expired'
    WHERE chain_id = ? AND status = 'pending' AND deadline <= ?
  `)
    .bind(chainId, now)
    .run()

  if (expiredResult.meta?.changes && expiredResult.meta.changes > 0) {
    console.log(`[Keeper] Expired ${expiredResult.meta.changes} orders`)
  }

  // 4. Check for out-of-range positions needing auto-recenter
  const outOfRangePositions = await env.DB.prepare(`
    SELECT pp.id, pp.position_id, pp.pool_id, pp.user_address, pp.min_drift_bps,
           lp.tick_lower, lp.tick_upper, lp.liquidity
    FROM position_policies pp
    JOIN liquidity_positions lp ON pp.position_id = lp.id::text
    WHERE pp.chain_id = ? AND pp.is_active = 1 AND pp.policy_type = 'auto_recenter'
      AND lp.is_active = 1
  `)
    .bind(chainId)
    .all<{
      id: number
      position_id: string
      pool_id: string
      user_address: string
      min_drift_bps: number
      tick_lower: number
      tick_upper: number
      liquidity: string
    }>()

  if (outOfRangePositions.results && outOfRangePositions.results.length > 0) {
    console.log(`[Keeper] Checking ${outOfRangePositions.results.length} positions for auto-recenter`)

    for (const pos of outOfRangePositions.results) {
      try {
        await env.KEEPER_QUEUE.send({
          type: "auto-recenter-check",
          policyId: pos.id,
          positionId: pos.position_id,
          poolId: pos.pool_id,
          userAddress: pos.user_address,
          tickLower: pos.tick_lower,
          tickUpper: pos.tick_upper,
          minDriftBps: pos.min_drift_bps,
          chainId,
        })
      } catch (error) {
        console.error(`[Keeper] Failed to enqueue auto-recenter for position ${pos.position_id}:`, error)
      }
    }
  }

  console.log("[Keeper] Tick completed")
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

  // Write poolSpot cache entries so TP/SL evaluator and auto-recenter can read them
  for (const pool of pools.results) {
    try {
      const [token0Price, token1Price] = await Promise.all([
        env.CACHE.get(`price:${pool.token0_address}`),
        env.CACHE.get(`price:${pool.token1_address}`),
      ])

      const t0 = token0Price ? (JSON.parse(token0Price) as { priceUsd?: number }) : null
      const t1 = token1Price ? (JSON.parse(token1Price) as { priceUsd?: number }) : null

      if (t0?.priceUsd && t1?.priceUsd && t0.priceUsd > 0 && t1.priceUsd > 0) {
        // Pool spot price = token0 price / token1 price (1e18-scaled)
        const spotPriceX18 = String(Math.round((t0.priceUsd / t1.priceUsd) * 1e18))
        await env.CACHE.put(
          `poolSpot:${pool.pool_id}`,
          JSON.stringify({ price: spotPriceX18, updatedAt: Date.now() }),
          { expirationTtl: 120 },
        )
      }
    } catch (error) {
      console.error(`Failed to write poolSpot for ${pool.pool_id}:`, error)
    }
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
