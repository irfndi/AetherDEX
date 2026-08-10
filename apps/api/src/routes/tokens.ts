/**
 * AetherDEX Token HTTP endpoints — Phase 0 G4
 *
 * Tokens come from the canonical Uniswap default token list (fetched +
 * validated: schema + EIP-55 checksums + chainId filter), served through
 * TokenListService. The D1 `tokens` table is only a write-through cache of
 * that list — never a separately curated source.
 */

import { Effect, Layer } from "effect"
import { Hono } from "hono"
import { getAddress } from "viem"
import { makeDbLayer } from "../db/client"
import { runEffect } from "../lib/effect-bridge"
import {
  makeTokenListFetcherLayer,
  TokenListService,
  TokenListServiceDeps,
  TokenListServiceLive,
} from "../services/token-list.service"

type Bindings = {
  DB: D1Database
  CACHE: KVNamespace
  STORAGE: R2Bucket
  CHAIN_ID: string
  ENVIRONMENT: string
  TOKEN_LIST_URL?: string
}

const DEFAULT_TOKEN_LIST_URL = "https://tokens.uniswap.org"
const CACHE_TTL_SECONDS = 6 * 60 * 60

const tokens = new Hono<{ Bindings: Bindings }>()

const tokenListLayer = (env: Bindings) => {
  const chainId = Number.parseInt(env.CHAIN_ID, 10)
  const depsLayer = Layer.succeed(TokenListServiceDeps, {
    kv: env.CACHE,
    chainId: Number.isNaN(chainId) ? 1 : chainId,
    cacheTtlSeconds: CACHE_TTL_SECONDS,
  })
  return TokenListServiceLive.pipe(
    Layer.provide(makeTokenListFetcherLayer(env.TOKEN_LIST_URL ?? DEFAULT_TOKEN_LIST_URL)),
    Layer.provide(makeDbLayer(env.DB)),
    Layer.provide(depsLayer),
  )
}

/**
 * GET /api/v1/tokens?verified=true&search=eth&limit=100
 */
tokens.get("/", async (c) => {
  // Non-numeric or negative `limit` must fall back to the default (100): NaN would
  // propagate to slice(0, NaN) → slice(0, 0) (silent empty result), and a negative
  // value would become slice(0, -n), which silently drops the last entries.
  const parsedLimit = Number.parseInt(c.req.query("limit") ?? "100", 10)
  const limit = Math.min(Number.isNaN(parsedLimit) || parsedLimit < 0 ? 100 : parsedLimit, 500)
  const search = c.req.query("search")
  const verifiedRaw = c.req.query("verified")
  let verified: boolean | undefined
  if (verifiedRaw !== undefined) {
    if (verifiedRaw !== "true" && verifiedRaw !== "false") {
      return c.json({ error: "verified must be 'true' or 'false'" }, 400)
    }
    verified = verifiedRaw === "true"
  }

  try {
    const program = Effect.gen(function* () {
      const tokenList = yield* TokenListService
      return yield* tokenList.listTokens({ limit, query: search, verified })
    })
    const list = await runEffect(program.pipe(Effect.provide(tokenListLayer(c.env))))
    // The canonical list is fully verified (isVerified: true); honor the filter
    // so ?verified=true returns the list and ?verified=false returns none.
    const filtered = verified === undefined ? list : list.filter((token) => token.isVerified === verified)
    return c.json({ tokens: filtered, count: filtered.length })
  } catch (err) {
    console.error("[tokens] GET / failed:", err)
    return c.json({ error: "Internal server error" }, 500)
  }
})

/**
 * GET /api/v1/tokens/:address
 */
tokens.get("/:address", async (c) => {
  const addressParam = c.req.param("address")
  if (!/^0x[a-fA-F0-9]{40}$/.test(addressParam)) {
    return c.json({ error: "Invalid token address" }, 400)
  }
  // Canonical list entries are keyed by EIP-55 checksummed address; normalize any
  // valid hex form (lowercase included) to its checksum so lookups always match.
  const address = getAddress(addressParam)

  try {
    const program = Effect.gen(function* () {
      const tokenList = yield* TokenListService
      return yield* tokenList.getToken(address)
    })
    const token = await runEffect(program.pipe(Effect.provide(tokenListLayer(c.env))))

    if (!token) {
      return c.json({ error: "Token not found" }, 404)
    }

    return c.json({ token })
  } catch (err) {
    console.error("[tokens] GET /:address failed:", err)
    return c.json({ error: "Internal server error" }, 500)
  }
})

export { tokens }
