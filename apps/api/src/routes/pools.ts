/**
 * AetherDEX Pool HTTP endpoints
 * Pool list, detail — queries D1 directly
 */

import { Hono } from "hono"

type Bindings = {
  DB: D1Database
  CACHE: KVNamespace
  STORAGE: R2Bucket
  CHAIN_ID: string
  ENVIRONMENT: string
}

const pools = new Hono<{ Bindings: Bindings }>()

type SortField = "tvl" | "volume" | "fees" | "created"
type SortDirection = "asc" | "desc"

/**
 * GET /api/v1/pools
 * Query params: limit, offset, sortBy (tvl|volume|fees|created), sortDirection, filterToken
 */
pools.get("/", async (c) => {
  const limit = Math.min(Number.parseInt(c.req.query("limit") ?? "50", 10), 200)
  const offset = Number.parseInt(c.req.query("offset") ?? "0", 10)
  const sortBy = (c.req.query("sortBy") ?? "tvl") as SortField
  const sortDirection = (c.req.query("sortDirection") ?? "desc") as SortDirection
  const filterToken = c.req.query("filterToken")

  const sortColumn: Record<SortField, string> = {
    tvl: "tvl_usd",
    volume: "volume_24h_usd",
    fees: "fees_24h_usd",
    created: "created_at",
  }

  const dir = sortDirection === "asc" ? "ASC" : "DESC"
  const column = sortColumn[sortBy] ?? sortColumn.tvl

  try {
    let query = `
      SELECT pool_id, token0_address, token1_address, fee, tick_spacing, hook_address,
             sqrt_price_x96, current_tick, liquidity, tvl_usd, volume_24h_usd, fees_24h_usd,
             is_active, created_at, updated_at
      FROM pools
    `
    const conditions: string[] = ["is_active = 1"]
    const bindings: (string | number)[] = []

    if (filterToken) {
      conditions.push("(token0_address = ? OR token1_address = ?)")
      bindings.push(filterToken, filterToken)
    }

    if (conditions.length > 0) {
      query += ` WHERE ${conditions.join(" AND ")}`
    }

    query += ` ORDER BY ${column} ${dir} LIMIT ? OFFSET ?`
    bindings.push(limit, offset)

    const result = await c.env.DB.prepare(query)
      .bind(...bindings)
      .all<{
        pool_id: string
        token0_address: string
        token1_address: string
        fee: number
        tick_spacing: number
        hook_address: string | null
        sqrt_price_x96: string
        current_tick: number
        liquidity: string
        tvl_usd: number
        volume_24h_usd: number
        fees_24h_usd: number
        is_active: number
        created_at: number
        updated_at: number
      }>()

    const poolList = (result.results ?? []).map((row) => ({
      poolId: row.pool_id,
      token0Address: row.token0_address,
      token1Address: row.token1_address,
      fee: row.fee,
      tickSpacing: row.tick_spacing,
      hookAddress: row.hook_address,
      sqrtPriceX96: row.sqrt_price_x96,
      currentTick: row.current_tick,
      liquidity: row.liquidity,
      tvlUsd: row.tvl_usd,
      volume24hUsd: row.volume_24h_usd,
      fees24hUsd: row.fees_24h_usd,
      isActive: Boolean(row.is_active),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }))

    return c.json({ pools: poolList, count: poolList.length })
  } catch (err) {
    return c.json({ error: String(err) }, 500)
  }
})

/**
 * GET /api/v1/pools/:poolId
 */
pools.get("/:poolId", async (c) => {
  const poolId = c.req.param("poolId")
  if (!/^0x[a-fA-F0-9]{64}$/.test(poolId)) {
    return c.json({ error: "Invalid poolId (must be 0x + 64 hex chars)" }, 400)
  }

  try {
    const result = await c.env.DB.prepare(
      `SELECT pool_id, token0_address, token1_address, fee, tick_spacing, hook_address,
              sqrt_price_x96, current_tick, liquidity, tvl_usd, volume_24h_usd, fees_24h_usd,
              is_active, created_at, updated_at
       FROM pools WHERE pool_id = ?`,
    )
      .bind(poolId)
      .first<{
        pool_id: string
        token0_address: string
        token1_address: string
        fee: number
        tick_spacing: number
        hook_address: string | null
        sqrt_price_x96: string
        current_tick: number
        liquidity: string
        tvl_usd: number
        volume_24h_usd: number
        fees_24h_usd: number
        is_active: number
        created_at: number
        updated_at: number
      }>()

    if (!result) {
      return c.json({ error: "Pool not found" }, 404)
    }

    return c.json({
      pool: {
        poolId: result.pool_id,
        token0Address: result.token0_address,
        token1Address: result.token1_address,
        fee: result.fee,
        tickSpacing: result.tick_spacing,
        hookAddress: result.hook_address,
        sqrtPriceX96: result.sqrt_price_x96,
        currentTick: result.current_tick,
        liquidity: result.liquidity,
        tvlUsd: result.tvl_usd,
        volume24hUsd: result.volume_24h_usd,
        fees24hUsd: result.fees_24h_usd,
        isActive: Boolean(result.is_active),
        createdAt: result.created_at,
        updatedAt: result.updated_at,
      },
    })
  } catch (err) {
    return c.json({ error: String(err) }, 500)
  }
})

export { pools }
