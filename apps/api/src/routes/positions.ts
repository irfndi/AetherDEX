/**
 * AetherDEX Liquidity Positions HTTP endpoints
 *
 * GET /api/v1/users/:address/positions — public, list user's active LP positions
 * POST /api/v1/positions — auth required, record a new LP position
 */

import { Hono } from "hono"
import { requireAuth, type AuthVariables } from "../auth/middleware"

type Bindings = {
  DB: D1Database
  CACHE: KVNamespace
  STORAGE: R2Bucket
  CHAIN_ID: string
  ENVIRONMENT: string
}

const positions = new Hono<{ Bindings: Bindings; Variables: AuthVariables }>()

/**
 * GET /api/v1/users/:address/positions
 * Get all active LP positions for a user (public — anyone can view)
 */
positions.get("/users/:address/positions", async (c) => {
  const address = c.req.param("address")
  if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
    return c.json({ error: "Invalid address" }, 400)
  }

  try {
    const result = await c.env.DB.prepare(
      `SELECT id, user_address, pool_id, tick_lower, tick_upper, liquidity,
              amount0, amount1, fees_earned_token0, fees_earned_token1,
              is_active, created_at, updated_at
       FROM liquidity_positions
       WHERE user_address = ? AND is_active = 1
       ORDER BY created_at DESC LIMIT 100`,
    )
      .bind(address)
      .all<{
        id: number
        user_address: string
        pool_id: string
        tick_lower: number
        tick_upper: number
        liquidity: string
        amount0: string
        amount1: string
        fees_earned_token0: string
        fees_earned_token1: string
        is_active: number
        created_at: number
        updated_at: number
      }>()

    return c.json({
      positions: (result.results ?? []).map((row) => ({
        id: row.id,
        userAddress: row.user_address,
        poolId: row.pool_id,
        tickLower: row.tick_lower,
        tickUpper: row.tick_upper,
        liquidity: row.liquidity,
        amount0: row.amount0,
        amount1: row.amount1,
        feesEarnedToken0: row.fees_earned_token0,
        feesEarnedToken1: row.fees_earned_token1,
        isActive: Boolean(row.is_active),
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      })),
      count: (result.results ?? []).length,
    })
  } catch (err) {
    return c.json({ error: String(err) }, 500)
  }
})

/**
 * POST /api/v1/positions
 * Record a new LP position (requires auth — user records their own position)
 */
positions.post("/", requireAuth, async (c) => {
  const session = c.get("session")
  if (!session) return c.json({ error: "Unauthorized" }, 401)

  const body = await c.req.json<{
    poolId?: string
    tickLower?: number
    tickUpper?: number
    liquidity?: string
    amount0?: string
    amount1?: string
  }>()

  if (!body.poolId || body.tickLower === undefined || body.tickUpper === undefined || !body.liquidity) {
    return c.json({ error: "poolId, tickLower, tickUpper, liquidity required" }, 400)
  }

  try {
    const now = Date.now()
    const result = await c.env.DB.prepare(
      `INSERT INTO liquidity_positions
       (user_address, pool_id, tick_lower, tick_upper, liquidity, amount0, amount1,
        fees_earned_token0, fees_earned_token1, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, '0', '0', 1, ?, ?)`,
    )
      .bind(
        session.userAddress,
        body.poolId,
        body.tickLower,
        body.tickUpper,
        body.liquidity,
        body.amount0 ?? "0",
        body.amount1 ?? "0",
        now,
        now,
      )
      .run()

    return c.json({ ok: true, positionId: result.meta.last_row_id })
  } catch (err) {
    return c.json({ error: String(err) }, 500)
  }
})

export { positions }
