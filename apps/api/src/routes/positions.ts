/**
 * AetherDEX Liquidity Positions HTTP endpoints
 *
 * GET /api/v1/users/:address/positions — public, list user's active LP positions
 * POST /api/v1/positions — auth required, record a new LP position
 *
 * Resolved through Effect queries (db/queries.ts) — D1 as single access path.
 */

import { Effect } from "effect"
import { Hono } from "hono"
import { type AuthVariables, requireAuth } from "../auth/middleware"
import { makeDbLayer } from "../db/client"
import { getPositionsByUser, insertPosition } from "../db/queries"
import { runEffect } from "../lib/effect-bridge"

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
    const list = await runEffect(getPositionsByUser(address, 100).pipe(Effect.provide(makeDbLayer(c.env.DB))))
    return c.json({ positions: list, count: list.length })
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
    const positionId = await runEffect(
      insertPosition({
        userAddress: session.userAddress,
        poolId: body.poolId,
        tickLower: body.tickLower,
        tickUpper: body.tickUpper,
        liquidity: body.liquidity,
        amount0: body.amount0 ?? "0",
        amount1: body.amount1 ?? "0",
      }).pipe(Effect.provide(makeDbLayer(c.env.DB))),
    )
    return c.json({ ok: true, positionId })
  } catch (err) {
    return c.json({ error: String(err) }, 500)
  }
})

export { positions }
