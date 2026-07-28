import { Effect, Layer } from "effect"
import type { PublicClient } from "viem"
import { makeDbLayer } from "../db/client"
import { getIndexerCursor, setIndexerCursor } from "../db/queries"
import { parseChainId } from "../lib/chain-id"
import { runEffect } from "../lib/effect-bridge"
import { IndexerService, IndexerServiceLive } from "../services/indexer.service"
import { V3LiquidityIndexer, V3LiquidityIndexerLive } from "../services/v3-liquidity-indexer.service"
import { readVolumeAlertConfig, runVolumeAlertsTick, type VolumeAlertSink } from "../services/volume-alerts.service"
import { buildIndexerChainConfig, isIndexerEnabled } from "./indexer-config"
import { finalizedV3Head, nextV3IndexerRange, V3_INDEXER_NAME } from "./v3-indexer-cursor"

function toScaledBigInt(value: number, decimals: number): bigint {
  const negative = value < 0
  const abs = Math.abs(value)
  const str = abs.toFixed(decimals)
  const [whole, frac] = str.split(".")
  const fracPadded = (frac ?? "").padEnd(decimals, "0").slice(0, decimals)
  const result = BigInt(whole) * 10n ** BigInt(decimals) + (fracPadded ? BigInt(fracPadded) : 0n)
  return negative ? -result : result
}

export interface CronEnv {
  DB: D1Database
  CACHE: KVNamespace
  STORAGE: R2Bucket
  PRICE_QUEUE: Queue
  SETTLE_QUEUE: Queue
  KEEPER_QUEUE: Queue
  CHAIN_ID: string
  RPC_URL?: string
  V3_POSITION_MANAGER_ADDRESS?: string
  V3_POSITION_MANAGER_DEPLOYMENT_BLOCK?: string
  INDEXER_ENABLED?: string
  INDEXER_BATCH_SIZE?: string
  V3_INDEXED_POOL_ADDRESSES?: string
  V4_POOL_MANAGER_ADDRESS?: string
  // Phase 3 volume-spike alerts — optional; absent hub keeps detection-only,
  // absent Telegram credentials keep notifications off (safe defaults).
  VOLUME_ALERT_HUB?: DurableObjectNamespace
  VOLUME_ALERT_WINDOW_SECONDS?: string
  VOLUME_ALERT_THRESHOLD_USD?: string
  VOLUME_ALERT_COOLDOWN_SECONDS?: string
  TELEGRAM_BOT_TOKEN?: string
  TELEGRAM_CHAT_ID?: string
}

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

  ctx.waitUntil(runPhase3Indexer(env).catch((err) => console.error("Cron Phase 3 indexer error:", err)))

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

  ctx.waitUntil(runVolumeAlerts(env).catch((err) => console.error("Cron volume alerts error:", err)))
}

/**
 * Phase 3 volume-spike alert tick. No-ops (never throws) unless the chain id is
 * valid; broadcasts only when the VOLUME_ALERT_HUB binding is present and only
 * notifies Telegram when its credentials are configured.
 */
export async function runVolumeAlerts(env: CronEnv): Promise<void> {
  const config = readVolumeAlertConfig(env)
  if (config === null) {
    console.log("[VolumeAlerts] invalid CHAIN_ID — skipping volume alert tick")
    return
  }

  const sink: VolumeAlertSink = {
    ...(env.VOLUME_ALERT_HUB !== undefined ? { hub: env.VOLUME_ALERT_HUB } : {}),
    telegram: { TELEGRAM_BOT_TOKEN: env.TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID: env.TELEGRAM_CHAT_ID },
  }
  if (env.VOLUME_ALERT_HUB === undefined) {
    console.log("[VolumeAlerts] VOLUME_ALERT_HUB binding missing — detection only, no broadcast")
  }

  const emitted = await runVolumeAlertsTick(env.DB, env.CACHE, config, sink)
  if (emitted.length > 0) {
    console.log(`[VolumeAlerts] emitted ${emitted.length} volume alert(s) on chain ${config.chainId}`)
  }
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

/**
 * Phase 3 indexer tick: advances every configured source from its persisted
 * cursor toward the chain head. No-ops unless INDEXER_ENABLED=true and the
 * chain config (RPC + at least one contract address) is complete. `clientFactory`
 * is a test seam; production omits it for the default viem HTTP client.
 */
export async function runPhase3Indexer(env: CronEnv, clientFactory?: (rpcUrl: string) => PublicClient): Promise<void> {
  if (!isIndexerEnabled(env)) {
    console.log("[Indexer] INDEXER_ENABLED != true — skipping Phase 3 indexer tick")
    return
  }
  const chainConfig = buildIndexerChainConfig(env, clientFactory)
  if (chainConfig === null) {
    console.log("[Indexer] RPC/contract addresses not configured — skipping Phase 3 indexer tick")
    return
  }

  await runEffect(
    Effect.gen(function* () {
      const indexer = yield* IndexerService
      const results = yield* indexer.indexChain(chainConfig.chainId)
      for (const result of results) {
        console.log(
          `[Indexer] ${result.source} ${result.fromBlock}..${result.toBlock} events=${result.eventsProcessed} cursorAdvanced=${result.cursorAdvanced}`,
        )
      }
    }).pipe(
      Effect.provide(IndexerServiceLive([chainConfig]).pipe(Layer.provide(makeDbLayer(env.DB)))),
      Effect.catch((error) => Effect.sync(() => console.error(`[Indexer] tick failed: ${String(error)}`))),
    ),
  )
}

async function runKeeperTick(env: CronEnv): Promise<void> {
  const chainId = Number.parseInt(env.CHAIN_ID, 10) || 11155111
  const now = Date.now()

  console.log(`[Keeper] Tick started for chain ${chainId}`)

  const pendingOrders = await env.DB.prepare(`
    SELECT id, onchain_order_id, pool_id, order_type, zero_for_one, amount_in, min_amount_out,
           trigger_price_x18, twap_window, slippage_bps, deadline, user_address
    FROM tp_sl_orders
    WHERE chain_id = ? AND status = 'pending' AND deadline > ?
    ORDER BY created_at ASC
    LIMIT 50
  `)
    .bind(chainId, now)
    .all<{
      id: number
      onchain_order_id: string | null
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

  for (const order of pendingOrders.results) {
    try {
      if (typeof order.onchain_order_id !== "string" || !/^[0-9]+$/.test(order.onchain_order_id)) {
        console.warn(`[Keeper] Order ${order.id} has no valid on-chain order ID, skipping enqueue`)
        continue
      }
      await env.KEEPER_QUEUE.send({
        type: "tp-sl-evaluate",
        orderId: order.id,
        onchainOrderId: order.onchain_order_id,
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

  const outOfRangePositions = await env.DB.prepare(`
    SELECT pp.id, pp.position_id, pp.pool_id, pp.user_address, pp.min_drift_bps,
           lp.tick_lower, lp.tick_upper, lp.liquidity
    FROM position_policies pp
    JOIN liquidity_positions lp ON pp.position_id = CAST(lp.id AS TEXT) AND lp.chain_id = pp.chain_id
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

  const pools = await env.DB.prepare(
    `SELECT pool_id, token0_address, token1_address FROM pools
     WHERE is_active = 1 ORDER BY tvl_usd DESC LIMIT 50`,
  ).all<{ pool_id: string; token0_address: string; token1_address: string }>()

  if (!pools.results) return

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

  const prices = new Map<string, { priceUsd?: number } | null>()
  const addresses = Array.from(tokenAddresses)
  for (let i = 0; i < addresses.length; i += 10) {
    const batch = addresses.slice(i, i + 10)
    const values = await Promise.all(
      batch.map(async (address) => {
        const payload = await env.CACHE.get(`price:${address}`)
        return [address, payload ? (JSON.parse(payload) as { priceUsd?: number }) : null] as const
      }),
    )
    for (const [address, price] of values) prices.set(address, price)
  }

  for (const pool of pools.results) {
    try {
      const t0 = prices.get(pool.token0_address) ?? null
      const t1 = prices.get(pool.token1_address) ?? null

      if (t0?.priceUsd && t1?.priceUsd && t0.priceUsd > 0 && t1.priceUsd > 0) {
        const PRICE_DECIMALS = 6
        const numerator = toScaledBigInt(t0.priceUsd, PRICE_DECIMALS)
        const denominator = toScaledBigInt(t1.priceUsd, PRICE_DECIMALS)
        if (denominator === 0n) continue
        const spotPriceX18 = String((numerator * 10n ** 18n) / denominator)
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
  const chainId = Number.parseInt(env.CHAIN_ID, 10)
  const tokens = await env.DB.prepare("SELECT address FROM tokens WHERE is_verified = 1 AND chain_id = ? LIMIT 200")
    .bind(Number.isNaN(chainId) ? 1 : chainId)
    .all<{
      address: string
    }>()

  if (!tokens.results || tokens.results.length === 0) return

  for (let i = 0; i < tokens.results.length; i += 50) {
    const batch = tokens.results.slice(i, i + 50).map((t) => t.address)
    await env.PRICE_QUEUE.send({
      type: "price-refresh",
      tokens: batch,
    })
  }

  console.log(`Enqueued price refresh for ${tokens.results.length} tokens`)
}
