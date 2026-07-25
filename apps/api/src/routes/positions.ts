/**
 * AetherDEX Liquidity Positions HTTP endpoints — Phase 0 G3
 *
 * GET /api/v1/users/:address/positions — public, list user's active LP positions
 * POST /api/v1/positions — auth required, record a new LP position
 *
 * Resolved through PositionService (Effect) — no raw D1 access in handlers.
 */

import { Effect, Layer } from "effect"
import { Hono } from "hono"
import { getAddress } from "viem"
import { type AuthVariables, requireAuth } from "../auth/middleware"
import { makeDbLayer } from "../db/client"
import { runEffect } from "../lib/effect-bridge"
import { PositionService, PositionServiceLive } from "../services/position.service"
import {
  V4PositionReadError,
  V4PositionReader,
  V4PositionReaderDeps,
  V4PositionReaderLive,
} from "../services/v4-position-reader.service"

type Bindings = {
  DB: D1Database
  CACHE: KVNamespace
  STORAGE: R2Bucket
  CHAIN_ID: string
  ENVIRONMENT: string
  RPC_URL: string
  POSITION_MANAGER_ADDRESS: string
}

const positions = new Hono<{ Bindings: Bindings; Variables: AuthVariables }>()

const positionLayer = (db: D1Database) => PositionServiceLive.pipe(Layer.provide(makeDbLayer(db)))

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
    const chainId = Number(c.env.CHAIN_ID)
    if (!Number.isSafeInteger(chainId) || chainId <= 0) return c.json({ error: "Invalid chain configuration" }, 500)
    const program = Effect.gen(function* () {
      const positionService = yield* PositionService
      return yield* positionService.listByUser(address, 100, chainId)
    })
    const list = await runEffect(program.pipe(Effect.provide(positionLayer(c.env.DB))))
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
    protocol?: "v3" | "v4"
    tokenId?: string
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

  const { poolId, tickLower, tickUpper, liquidity } = body

  try {
    const program = Effect.gen(function* () {
      const positionService = yield* PositionService
      return yield* positionService.recordPosition({
        userAddress: session.userAddress,
        chainId: Number(c.env.CHAIN_ID),
        protocol: body.protocol,
        tokenId: body.tokenId,
        poolId,
        tickLower,
        tickUpper,
        liquidity,
        amount0: body.amount0 ?? "0",
        amount1: body.amount1 ?? "0",
      })
    })
    const positionId = await runEffect(program.pipe(Effect.provide(positionLayer(c.env.DB))))
    return c.json({ ok: true, positionId })
  } catch (err) {
    return c.json({ error: String(err) }, 500)
  }
})

positions.post("/:tokenId/reconcile", requireAuth, async (c) => {
  const session = c.get("session")
  const tokenId = c.req.param("tokenId")
  const chainId = Number(c.env.CHAIN_ID)
  if (!session) return c.json({ error: "Unauthorized" }, 401)
  if (typeof tokenId !== "string" || !/^\d+$/.test(tokenId)) return c.json({ error: "Invalid token id" }, 400)
  if (!Number.isSafeInteger(chainId) || chainId <= 0) return c.json({ error: "Invalid chain configuration" }, 500)
  try {
    const program = Effect.gen(function* () {
      const positionService = yield* PositionService
      return yield* positionService.reconcileV3Position(session.userAddress, tokenId, chainId)
    })
    const position = await runEffect(program.pipe(Effect.provide(positionLayer(c.env.DB))))
    return position ? c.json({ position }) : c.json({ error: "Position not indexed for this owner" }, 404)
  } catch (err) {
    return c.json({ error: String(err) }, 500)
  }
})

positions.post("/positions/v4/:tokenId/reconcile", requireAuth, async (c) => {
  const session = c.get("session")
  const tokenId = c.req.param("tokenId")
  const chainId = Number(c.env.CHAIN_ID)
  if (!session) return c.json({ error: "Unauthorized" }, 401)
  if (typeof tokenId !== "string" || !/^\d+$/.test(tokenId)) return c.json({ error: "Invalid token id" }, 400)
  if (!Number.isSafeInteger(chainId) || chainId <= 0) return c.json({ error: "Invalid chain configuration" }, 500)
  const rpcUrl = c.env.RPC_URL
  const managerAddress = c.env.POSITION_MANAGER_ADDRESS
  if (!rpcUrl || !/^0x[a-fA-F0-9]{40}$/.test(managerAddress ?? "")) {
    return c.json({ error: "V4 position reconciliation is not configured" }, 503)
  }
  try {
    const readerLayer = V4PositionReaderLive.pipe(
      Layer.provide(
        Layer.succeed(V4PositionReaderDeps, {
          rpcUrl,
          managerAddress: getAddress(managerAddress),
          chainId,
        }),
      ),
    )
    const program = Effect.gen(function* () {
      const reader = yield* V4PositionReader
      const state = yield* reader.read(tokenId)
      if (state.owner.toLowerCase() !== session.userAddress.toLowerCase()) {
        return yield* Effect.fail(new V4PositionReadError("Position is not owned by the authenticated wallet"))
      }
      const positionService = yield* PositionService
      const positionId = yield* positionService.reconcileV4Position(session.userAddress, tokenId, chainId, state)
      return { positionId, state }
    })
    const result = await runEffect(program.pipe(Effect.provide(Layer.merge(positionLayer(c.env.DB), readerLayer))))
    if (result.positionId === null) return c.json({ error: "Position not indexed for this owner" }, 404)
    return c.json({
      ok: true,
      positionId: result.positionId,
      tokenId,
      state: {
        owner: result.state.owner,
        poolKey: result.state.poolKey,
        tickLower: result.state.tickLower,
        tickUpper: result.state.tickUpper,
        liquidity: result.state.liquidity.toString(),
      },
    })
  } catch (err) {
    if (err instanceof V4PositionReadError) return c.json({ error: "Unable to read v4 position state" }, 502)
    return c.json({ error: "Unable to reconcile v4 position" }, 500)
  }
})

export { positions }
