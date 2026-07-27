/**
 * AetherDEX Pool HTTP endpoints
 * Pool list + detail — resolved through PoolService (Effect), D1 as single path.
 */

import { Effect, Layer } from "effect"
import { Hono } from "hono"
import { makeDbLayer } from "../db/client"
import { parseChainId, parseNonNegativeInteger } from "../lib/chain-id"
import { runEffect } from "../lib/effect-bridge"
import { type PoolQueryOptions, PoolService, PoolServiceLive } from "../services/pool.service"

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

const poolLayer = (db: D1Database) => PoolServiceLive.pipe(Layer.provide(makeDbLayer(db)))

/**
 * GET /api/v1/pools
 * Query params: limit, offset, sortBy (tvl|volume|fees|created), sortDirection, filterToken
 */
pools.get("/", async (c) => {
  const chainId = parseChainId(c.env.CHAIN_ID)
  if (chainId === null) return c.json({ error: "Invalid chain configuration" }, 500)
  const requestedLimit = parseNonNegativeInteger(c.req.query("limit") ?? "50")
  const offset = parseNonNegativeInteger(c.req.query("offset") ?? "0")
  if (requestedLimit === null || requestedLimit < 1 || requestedLimit > 200) {
    return c.json({ error: "limit must be an integer from 1 to 200" }, 400)
  }
  if (offset === null) return c.json({ error: "offset must be a non-negative integer" }, 400)
  const limit = requestedLimit
  const sortBy = (c.req.query("sortBy") ?? "tvl") as SortField
  const sortDirection = (c.req.query("sortDirection") ?? "desc") as SortDirection
  const filterToken = c.req.query("filterToken")

  const options: PoolQueryOptions = { chainId, limit, offset, sortBy, sortDirection, filterByToken: filterToken }

  try {
    const program = Effect.gen(function* () {
      const poolService = yield* PoolService
      return yield* poolService.listPools(options)
    })
    const poolList = await runEffect(program.pipe(Effect.provide(poolLayer(c.env.DB))))
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
  const chainId = parseChainId(c.env.CHAIN_ID)
  if (chainId === null) return c.json({ error: "Invalid chain configuration" }, 500)

  try {
    const program = Effect.gen(function* () {
      const poolService = yield* PoolService
      return yield* poolService.getPool(poolId, chainId)
    })
    const pool = await runEffect(program.pipe(Effect.provide(poolLayer(c.env.DB))))

    if (!pool) {
      return c.json({ error: "Pool not found" }, 404)
    }

    return c.json({ pool })
  } catch (err) {
    return c.json({ error: String(err) }, 500)
  }
})

export { pools }
