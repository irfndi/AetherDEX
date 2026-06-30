/**
 * AetherDEX Queue Handlers
 * Processes messages from Cloudflare Queues:
 * - price-refresh: refresh token prices from external sources
 * - trade-settlement: archive completed trades to R2
 */

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

export type QueueMessage =
  | PriceRefreshMessage
  | TradeSettlementMessage
  | TradeArchiveMessage

interface QueueEnv {
  DB: D1Database
  CACHE: KVNamespace
  STORAGE: R2Bucket
  CHAIN_ID: string
}

/**
 * Process a batch of queue messages
 */
export const processQueueBatch = async (
  batch: MessageBatch<unknown>,
  env: QueueEnv,
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

async function handlePriceRefresh(
  msg: PriceRefreshMessage,
  env: { CACHE: KVNamespace; CHAIN_ID: string },
): Promise<void> {
  console.log(`Refreshing prices for ${msg.tokens.length} tokens`)

  for (const token of msg.tokens) {
    try {
      // Fetch from external price feed
      const priceUsd = await fetchTokenPrice(token, env.CHAIN_ID)

      // Store in KV with 60s TTL
      await env.CACHE.put(
        `price:${token}`,
        JSON.stringify({ tokenAddress: token, priceUsd, updatedAt: Date.now() }),
        { expirationTtl: 60 },
      )
    } catch (error) {
      console.error(`Failed to refresh price for ${token}:`, error)
    }
  }
}

async function handleTradeSettlement(
  msg: TradeSettlementMessage,
  env: { DB: D1Database },
): Promise<void> {
  console.log(`Settling trade ${msg.txHash}`)

  // Update transaction status in D1
  await env.DB.prepare(
    `UPDATE transactions SET status = 'confirmed', updated_at = ? WHERE tx_hash = ?`,
  )
    .bind(Date.now(), msg.txHash)
    .run()
}

async function handleTradeArchive(
  msg: TradeArchiveMessage,
  env: { DB: D1Database; STORAGE: R2Bucket },
): Promise<void> {
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
  const trades =
    result.results
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
      .join("\n") + "\n"

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

async function fetchTokenPrice(tokenAddress: string, chainId: string): Promise<number> {
  // Stub — actual implementation uses CoinGecko/Chainlink/Pyth
  // Will be replaced with real fetch in T17/T18
  console.log(`Price fetch stub for ${tokenAddress} on chain ${chainId}`)
  return 0
}
