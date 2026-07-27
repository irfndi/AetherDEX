/**
 * AetherDEX Queue Handlers — Phase 2 Extended
 * Processes messages from Cloudflare Queues:
 * - price-refresh: refresh token prices from external sources
 * - trade-settlement: archive completed trades to R2
 * - **NEW: tp-sl-evaluate: evaluate and execute TP/SL orders**
 * - **NEW: auto-recenter-check: check and queue position rebalances**
 */

import { Effect, Layer } from "effect"
import { createPublicClient, http, type PublicClient } from "viem"
import { makeDbLayer } from "../db/client"
import { runEffect } from "../lib/effect-bridge"
import { IndexerService, IndexerServiceLive, type IndexerSource } from "../services/indexer.service"
import { buildIndexerChainConfig, isIndexerEnabled } from "./indexer-config"

const AETHER_HOOK_ABI = [
  {
    name: "getCurrentTwap",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "poolId", type: "bytes32" },
      { name: "secondsAgo", type: "uint32" },
    ],
    outputs: [{ name: "priceX18", type: "uint256" }],
  },
] as const

export interface PriceRefreshMessage {
  type: "price-refresh"
  tokens: string[]
}

export interface TradeSettlementMessage {
  type: "trade-settlement"
  txHash: string
}

export interface TradeArchiveMessage {
  type: "trade-archive"
  year: number
  month: number
}

export interface TpSlEvaluateMessage {
  type: "tp-sl-evaluate"
  orderId: number
  poolId: string
  orderType: string
  zeroForOne: boolean
  amountIn: string
  minAmountOut: string
  triggerPriceX18: string
  twapWindow: number
  slippageBps: number
  deadline: number
  userAddress: string
  chainId: number
}

export interface AutoRecenterCheckMessage {
  type: "auto-recenter-check"
  policyId: number
  positionId: string
  poolId: string
  userAddress: string
  tickLower: number
  tickUpper: number
  minDriftBps: number
  chainId: number
}

export interface IndexerBackfillMessage {
  type: "indexer-backfill"
  chainId: number
  source: "v3_position_manager" | "v3_pool" | "v4_pool_manager"
  fromBlock: string
  toBlock: string
}

export type QueueMessage =
  | PriceRefreshMessage
  | TradeSettlementMessage
  | TradeArchiveMessage
  | TpSlEvaluateMessage
  | AutoRecenterCheckMessage
  | IndexerBackfillMessage

export interface QueueEnv {
  DB: D1Database
  CACHE: KVNamespace
  STORAGE: R2Bucket
  WEBSOCKET_HUB: DurableObjectNamespace
  CHAIN_ID: string
  RPC_URL?: string
  AETHER_HOOK_ADDRESS?: string
  INDEXER_ENABLED?: string
  INDEXER_BATCH_SIZE?: string
  V3_POSITION_MANAGER_ADDRESS?: string
  V3_INDEXED_POOL_ADDRESSES?: string
  V4_POOL_MANAGER_ADDRESS?: string
}

const INDEXER_SOURCES: readonly IndexerSource[] = ["v3_position_manager", "v3_pool", "v4_pool_manager"]

const readIntegerCacheValue = (payload: string, field: string): string | null => {
  try {
    const value = (JSON.parse(payload) as Record<string, unknown>)[field]
    if (typeof value !== "string" || !/^[0-9]+$/.test(value)) return null
    BigInt(value)
    return value
  } catch {
    return null
  }
}

/**
 * Read the TWAP from the on-chain AetherHook oracle and cache it in KV.
 * Returns the price as a decimal string, or null when unconfigured / on error.
 */
async function readTwapFromChain(
  env: Pick<QueueEnv, "CACHE" | "RPC_URL" | "AETHER_HOOK_ADDRESS">,
  poolId: string,
  twapWindow: number,
): Promise<string | null> {
  const rpcUrl = env.RPC_URL
  const hookAddress = env.AETHER_HOOK_ADDRESS
  if (!rpcUrl || !hookAddress) {
    console.warn("[Keeper] RPC_URL or AETHER_HOOK_ADDRESS not configured — skipping on-chain TWAP read")
    return null
  }

  try {
    const client = createPublicClient({ transport: http(rpcUrl) })
    const priceX18 = await client.readContract({
      address: hookAddress as `0x${string}`,
      abi: AETHER_HOOK_ABI,
      functionName: "getCurrentTwap",
      args: [poolId as `0x${string}`, twapWindow],
    })

    const priceStr = priceX18.toString()
    const twapKey = `twap:${poolId}:${twapWindow}`
    await env.CACHE.put(twapKey, JSON.stringify({ price: priceStr, updatedAt: Date.now() }), {
      expirationTtl: 300,
    })

    return priceStr
  } catch (error) {
    console.error(`[Keeper] On-chain TWAP read failed for pool ${poolId}:`, error)
    return null
  }
}

/**
 * Process a batch of queue messages. `clientFactory` is a test seam forwarded
 * to the indexer backfill handler; production omits it for the default viem client.
 */
export const processQueueBatch = async (
  batch: MessageBatch<unknown>,
  env: QueueEnv,
  clientFactory?: (rpcUrl: string) => PublicClient,
): Promise<void> => {
  console.log(`Processing ${batch.messages.length} queue messages`)

  for (const message of batch.messages) {
    const msg = message.body as QueueMessage
    try {
      switch (msg.type) {
        case "price-refresh":
          await handlePriceRefresh(msg, env)
          break
        case "trade-settlement":
          await handleTradeSettlement(msg, env)
          break
        case "trade-archive":
          await handleTradeArchive(msg, env)
          break
        case "tp-sl-evaluate":
          await handleTpSlEvaluate(msg, env)
          break
        case "auto-recenter-check":
          await handleAutoRecenterCheck(msg, env)
          break
        case "indexer-backfill":
          await handleIndexerBackfill(msg, env, clientFactory)
          break
        default: {
          const _never: never = msg
          console.warn(`Unknown queue message type: ${JSON.stringify(_never)}`)
        }
      }
      message.ack()
    } catch (error) {
      console.error(`Queue message failed: ${JSON.stringify(msg)}`, error)
      message.retry()
    }
  }
}

// ─── Indexer Backfill Handler ───────────────────────────────────────────────

async function handleIndexerBackfill(
  msg: IndexerBackfillMessage,
  env: QueueEnv,
  clientFactory?: (rpcUrl: string) => PublicClient,
): Promise<void> {
  if (!isIndexerEnabled(env)) {
    console.log("[Indexer] Backfill skipped: INDEXER_ENABLED != true")
    return
  }

  const source = INDEXER_SOURCES.find((candidate) => candidate === msg.source)
  const isDecimalString = (value: string): boolean => /^\d+$/.test(value)
  if (
    source === undefined ||
    !Number.isSafeInteger(msg.chainId) ||
    msg.chainId <= 0 ||
    !isDecimalString(msg.fromBlock) ||
    !isDecimalString(msg.toBlock) ||
    BigInt(msg.toBlock) < BigInt(msg.fromBlock)
  ) {
    console.warn(`[Indexer] Invalid backfill message — acking without retry: ${JSON.stringify(msg)}`)
    return
  }

  const chainConfig = buildIndexerChainConfig(env, clientFactory)
  if (chainConfig === null) {
    console.log("[Indexer] Backfill skipped: RPC/contract addresses not configured")
    return
  }
  if (msg.chainId !== chainConfig.chainId) {
    console.warn(
      `[Indexer] Backfill chain ${msg.chainId} does not match configured chain ${chainConfig.chainId} — acking`,
    )
    return
  }

  const fromBlock = BigInt(msg.fromBlock)
  const toBlock = BigInt(msg.toBlock)

  await runEffect(
    Effect.gen(function* () {
      const indexer = yield* IndexerService
      const result = yield* indexer.indexRange(msg.chainId, source, fromBlock, toBlock)
      console.log(
        `[Indexer] Backfill ${result.source} ${result.fromBlock}..${result.toBlock} events=${result.eventsProcessed} (cursor untouched)`,
      )
    }).pipe(
      Effect.provide(IndexerServiceLive([chainConfig]).pipe(Layer.provide(makeDbLayer(env.DB)))),
      Effect.catch((error) => Effect.sync(() => console.error(`[Indexer] Backfill failed (acked): ${String(error)}`))),
    ),
  )
}

// ─── TP/SL Evaluation Handler ───────────────────────────────────────────────

async function handleTpSlEvaluate(msg: TpSlEvaluateMessage, env: QueueEnv): Promise<void> {
  console.log(`[Keeper] Evaluating TP/SL order ${msg.orderId} for pool ${msg.poolId}`)

  // 1. Verify order is still pending
  const order = await env.DB.prepare(
    "SELECT id, status, deadline FROM tp_sl_orders WHERE id = ? AND chain_id = ? AND status = 'pending'",
  )
    .bind(msg.orderId, msg.chainId)
    .first<{ id: number; status: string; deadline: number }>()

  if (!order) {
    console.log(`[Keeper] Order ${msg.orderId} no longer pending, skipping`)
    return
  }

  // 2. Check if order has expired
  if (Date.now() > msg.deadline) {
    await env.DB.prepare("UPDATE tp_sl_orders SET status = 'expired' WHERE id = ? AND chain_id = ?")
      .bind(msg.orderId, msg.chainId)
      .run()
    console.log(`[Keeper] Order ${msg.orderId} expired`)
    return
  }

  // 3. Read current spot price from pool state (via KV cache or on-chain)
  // Prices are stored as price:${tokenAddress} — for pool spot price we need
  // to read from the pool-specific cache or derive from token prices
  const spotPriceKey = `poolSpot:${msg.poolId}`
  const spotPriceData = await env.CACHE.get(spotPriceKey)
  if (!spotPriceData) {
    console.log(`[Keeper] No spot price available for pool ${msg.poolId}, skipping`)
    return
  }

  const spotPriceX18 = readIntegerCacheValue(spotPriceData, "price")
  if (spotPriceX18 === null) {
    console.warn(`[Keeper] Invalid spot price payload for pool ${msg.poolId}, skipping`)
    return
  }

  // 4. Read TWAP — populate cache from on-chain AetherHook oracle, then read from KV
  const twapKey = `twap:${msg.poolId}:${msg.twapWindow}`

  let twapPriceX18: string | null = null
  const twapData = await env.CACHE.get(twapKey)
  if (twapData !== null) {
    twapPriceX18 = readIntegerCacheValue(twapData, "price")
  }

  if (twapPriceX18 === null) {
    const chainTwap = await readTwapFromChain(env, msg.poolId, msg.twapWindow)
    if (chainTwap !== null) {
      twapPriceX18 = readIntegerCacheValue(JSON.stringify({ price: chainTwap }), "price")
    }
  }

  if (twapPriceX18 === null) {
    console.log(`[Keeper] No valid TWAP available for pool ${msg.poolId}, skipping`)
    return
  }

  // 5. Evaluate dual trigger condition
  const triggerPrice = BigInt(msg.triggerPriceX18)
  const spotPrice = BigInt(spotPriceX18)
  const twapPrice = BigInt(twapPriceX18)

  let isTriggered = false

  if (msg.orderType === "take_profit") {
    if (msg.zeroForOne) {
      // TP: price must go DOWN
      isTriggered = spotPrice <= triggerPrice
      isTriggered = isTriggered && twapPrice <= triggerPrice
    } else {
      // TP: price must go UP
      isTriggered = spotPrice >= triggerPrice
      isTriggered = isTriggered && twapPrice >= triggerPrice
    }
  } else {
    // STOP_LOSS
    if (msg.zeroForOne) {
      // SL: price must go UP
      isTriggered = spotPrice >= triggerPrice
      isTriggered = isTriggered && twapPrice >= triggerPrice
    } else {
      // SL: price must go DOWN
      isTriggered = spotPrice <= triggerPrice
      isTriggered = isTriggered && twapPrice <= triggerPrice
    }
  }

  if (!isTriggered) {
    console.log(
      `[Keeper] Order ${msg.orderId} trigger not breached (spot: ${spotPriceX18}, twap: ${twapPriceX18}, trigger: ${msg.triggerPriceX18})`,
    )
    return
  }

  // 6. Trigger is breached — mark for execution
  console.log(`[Keeper] Order ${msg.orderId} trigger BREACHED — marking for execution`)

  // Update order status to 'triggered' and enqueue for on-chain execution
  await env.DB.prepare(`
    UPDATE tp_sl_orders
    SET status = 'triggered', updated_at = ?
    WHERE id = ? AND chain_id = ? AND status = 'pending'
  `)
    .bind(Date.now(), msg.orderId, msg.chainId)
    .run()

  // In production, this would also submit the transaction via the keeper's funded signer
  // For now, log the execution intent
  console.log(
    JSON.stringify({
      event: "tp_sl_triggered",
      orderId: msg.orderId,
      poolId: msg.poolId,
      orderType: msg.orderType,
      spotPriceX18: spotPriceX18,
      twapPriceX18,
      triggerPriceX18: msg.triggerPriceX18,
      userAddress: msg.userAddress,
      amountIn: msg.amountIn,
    }),
  )
}

// ─── Auto-Recenter Check Handler ────────────────────────────────────────────

async function handleAutoRecenterCheck(msg: AutoRecenterCheckMessage, env: QueueEnv): Promise<void> {
  console.log(`[Keeper] Checking auto-recenter for position ${msg.positionId}`)

  // 1. Verify policy is still active
  const policy = await env.DB.prepare(
    "SELECT id, is_active, last_rebalance_at, cooldown_seconds FROM position_policies WHERE id = ? AND chain_id = ? AND is_active = 1",
  )
    .bind(msg.policyId, msg.chainId)
    .first<{ id: number; is_active: number; last_rebalance_at: number | null; cooldown_seconds: number }>()

  if (!policy) {
    console.log(`[Keeper] Policy ${msg.policyId} no longer active, skipping`)
    return
  }

  // 2. Check cooldown (anti-whipsaw)
  const now = Date.now()
  const lastRebalance = policy.last_rebalance_at ?? 0
  const elapsed = now - lastRebalance

  if (elapsed < policy.cooldown_seconds * 1000) {
    const remaining = policy.cooldown_seconds - Math.floor(elapsed / 1000)
    console.log(`[Keeper] Position ${msg.positionId}: cooldown active, ${Math.ceil(remaining)}s remaining`)
    return
  }

  // 3. Read current tick from pool state (use same key as tp-sl-evaluate)
  const spotPriceKey = `poolSpot:${msg.poolId}`
  const spotPriceData = await env.CACHE.get(spotPriceKey)
  if (!spotPriceData) {
    console.log(`[Keeper] No spot price for pool ${msg.poolId}, skipping`)
    return
  }

  // Pool spot data stores price (1e18-scaled ratio). Derive tick from price.
  let spotParsed: { tick?: unknown }
  try {
    spotParsed = JSON.parse(spotPriceData) as { tick?: unknown }
  } catch {
    console.warn(`[Keeper] Invalid pool state payload for pool ${msg.poolId}, skipping`)
    return
  }
  const currentTick =
    typeof spotParsed.tick === "number" && Number.isInteger(spotParsed.tick) ? spotParsed.tick : undefined

  if (currentTick === undefined) {
    console.log(`[Keeper] No tick/price data for pool ${msg.poolId}, skipping`)
    return
  }

  // 4. Check if position is out of range
  const isInRange = currentTick >= msg.tickLower && currentTick <= msg.tickUpper

  if (isInRange) {
    console.log(
      `[Keeper] Position ${msg.positionId} is in range [${msg.tickLower}, ${msg.tickUpper}], no rebalance needed`,
    )
    return
  }

  // 5. Compute drift
  const driftTicks = currentTick < msg.tickLower ? msg.tickLower - currentTick : currentTick - msg.tickUpper
  const rangeSize = msg.tickUpper - msg.tickLower
  const driftBps = rangeSize > 0 ? Math.floor((driftTicks * 10_000) / rangeSize) : 10_000

  if (driftBps < msg.minDriftBps) {
    console.log(`[Keeper] Position ${msg.positionId} drift ${driftBps} bps < threshold ${msg.minDriftBps} bps`)
    return
  }

  // 6. Position is out of range and drift exceeds threshold — queue rebalance
  console.log(
    JSON.stringify({
      event: "auto_recenter_triggered",
      positionId: msg.positionId,
      poolId: msg.poolId,
      currentTick,
      tickLower: msg.tickLower,
      tickUpper: msg.tickUpper,
      driftBps,
      userAddress: msg.userAddress,
    }),
  )

  // Update last_rebalance_at
  await env.DB.prepare(`
    UPDATE position_policies
    SET last_rebalance_at = ?, rebalance_count = rebalance_count + 1
    WHERE id = ? AND chain_id = ?
  `)
    .bind(now, msg.policyId, msg.chainId)
    .run()
}

// ─── Existing Handlers ──────────────────────────────────────────────────────

async function handlePriceRefresh(
  msg: PriceRefreshMessage,
  env: { CACHE: KVNamespace; WEBSOCKET_HUB: DurableObjectNamespace; CHAIN_ID: string },
): Promise<void> {
  console.log(`Refreshing prices for ${msg.tokens.length} tokens`)

  const hub = env.WEBSOCKET_HUB.get(env.WEBSOCKET_HUB.idFromName("price-hub"))

  for (const token of msg.tokens) {
    try {
      // Fetch from external price feed
      const priceUsd = await fetchTokenPrice(token, env.CHAIN_ID)
      const updatedAt = Date.now()

      // Store in KV with 60s TTL
      await env.CACHE.put(`price:${token}`, JSON.stringify({ tokenAddress: token, priceUsd, updatedAt }), {
        expirationTtl: 60,
      })

      // Publish the refresh to the WebSocket hub so connected clients (PriceTicker)
      // actually receive live updates — without this the /ws/prices route is only a
      // handshake and subscribers never get a price. Only broadcast VALID prices:
      // fetchTokenPrice returns 0 on lookup failure, and replacing a ticker's last
      // good value with $0 would be worse than no update at all.
      if (priceUsd > 0) {
        await hub.fetch(
          new Request("http://price-hub/price", {
            method: "POST",
            body: JSON.stringify({ tokenAddress: token, price: priceUsd, updatedAt }),
          }),
        )
      }
    } catch (error) {
      console.error(`Failed to refresh price for ${token}:`, error)
    }
  }
}

async function handleTradeSettlement(msg: TradeSettlementMessage, env: { DB: D1Database }): Promise<void> {
  console.log(`Settling trade ${msg.txHash}`)

  // Update transaction status in D1
  await env.DB.prepare(`UPDATE transactions SET status = 'confirmed', updated_at = ? WHERE tx_hash = ?`)
    .bind(Date.now(), msg.txHash)
    .run()
}

async function handleTradeArchive(msg: TradeArchiveMessage, env: { DB: D1Database; STORAGE: R2Bucket }): Promise<void> {
  console.log(`Archiving trades for ${msg.year}-${msg.month}`)

  // Query D1 for trades in this month
  const startOfMonth = new Date(msg.year, msg.month - 1, 1).getTime() / 1000
  const endOfMonth = new Date(msg.year, msg.month, 1).getTime() / 1000

  const result = await env.DB.prepare(
    `SELECT tx_hash, user_address, pool_id, tx_type, token_in, token_out,
            amount_in, amount_out, amount_usd, block_number, block_timestamp
     FROM transactions
     WHERE block_timestamp >= ? AND block_timestamp < ? AND tx_type = 'swap'
     ORDER BY block_timestamp ASC`,
  )
    .bind(startOfMonth, endOfMonth)
    .all<{
      tx_hash: string
      user_address: string
      pool_id: string
      tx_type: string
      token_in: string
      token_out: string
      amount_in: string
      amount_out: string
      amount_usd: number
      block_number: number
      block_timestamp: number
    }>()

  if (!result.results || result.results.length === 0) {
    console.log(`No trades to archive for ${msg.year}-${msg.month}`)
    return
  }

  // Convert to JSONL
  const trades = `${result.results
    .map((row) =>
      JSON.stringify({
        txHash: row.tx_hash,
        userAddress: row.user_address,
        poolId: row.pool_id,
        txType: row.tx_type,
        tokenIn: row.token_in,
        tokenOut: row.token_out,
        amountIn: row.amount_in,
        amountOut: row.amount_out,
        amountUsd: row.amount_usd,
        blockNumber: row.block_number,
        blockTimestamp: row.block_timestamp,
      }),
    )
    .join("\n")}\n`

  // Compress and upload to R2
  const blob = new Blob([trades], { type: "application/jsonl" })
  const stream = blob.stream().pipeThrough(new CompressionStream("gzip"))
  const compressed = await new Response(stream).arrayBuffer()
  const key = `trades/${msg.year}/${String(msg.month).padStart(2, "0")}/trades.jsonl.gz`

  await env.STORAGE.put(key, new Uint8Array(compressed), {
    httpMetadata: { contentType: "application/gzip", contentEncoding: "gzip" },
  })

  console.log(`Archived ${result.results.length} trades to ${key}`)
}

async function fetchTokenPrice(tokenAddress: string, _chainId: string): Promise<number> {
  try {
    const res = await fetch(
      `https://api.coingecko.com/api/v3/simple/token_price/ethereum?contract_addresses=${tokenAddress}&vs_currencies=usd`,
    )
    if (!res.ok) {
      console.error(`CoinGecko returned ${res.status} for ${tokenAddress}`)
      return 0
    }
    const data = (await res.json()) as Record<string, { usd?: number }>
    const entry = data[tokenAddress.toLowerCase()]
    const price = entry?.usd
    if (typeof price !== "number" || price <= 0) {
      console.error(`No valid price from CoinGecko for ${tokenAddress}`)
      return 0
    }
    return price
  } catch (err) {
    console.error(`fetchTokenPrice failed for ${tokenAddress}:`, err)
    return 0
  }
}
