/**
 * AetherDEX Token HTTP endpoints
 * Token list, detail, search — resolved through TokenService (Effect), D1 as single path.
 */

import { Effect, Layer } from "effect"
import { Hono } from "hono"
import { makeDbLayer } from "../db/client"
import { runEffect } from "../lib/effect-bridge"
import { TokenService, TokenServiceLive } from "../services/token.service"

type Bindings = {
  DB: D1Database
  CACHE: KVNamespace
  STORAGE: R2Bucket
  CHAIN_ID: string
  ENVIRONMENT: string
}

const tokens = new Hono<{ Bindings: Bindings }>()

const tokenLayer = (db: D1Database) => TokenServiceLive.pipe(Layer.provide(makeDbLayer(db)))

/**
 * GET /api/v1/tokens?verified=true&search=eth&limit=100
 */
tokens.get("/", async (c) => {
  const limit = Math.min(Number.parseInt(c.req.query("limit") ?? "100", 10), 500)
  const verified = c.req.query("verified") === "true"
  const search = c.req.query("search")

  try {
    const program = Effect.gen(function* () {
      const tokenService = yield* TokenService
      return yield* tokenService.listTokens({ limit, verified, query: search })
    })
    const tokenList = await runEffect(program.pipe(Effect.provide(tokenLayer(c.env.DB))))
    return c.json({ tokens: tokenList, count: tokenList.length })
  } catch (err) {
    return c.json({ error: String(err) }, 500)
  }
})

/**
 * GET /api/v1/tokens/:address
 */
tokens.get("/:address", async (c) => {
  const address = c.req.param("address")
  if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
    return c.json({ error: "Invalid token address" }, 400)
  }

  try {
    const program = Effect.gen(function* () {
      const tokenService = yield* TokenService
      return yield* tokenService.getToken(address)
    })
    const token = await runEffect(program.pipe(Effect.provide(tokenLayer(c.env.DB))))

    if (!token) {
      return c.json({ error: "Token not found" }, 404)
    }

    return c.json({ token })
  } catch (err) {
    return c.json({ error: String(err) }, 500)
  }
})

export { tokens }
