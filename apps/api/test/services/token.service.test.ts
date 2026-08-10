/**
 * Token service (src/services/token.service.ts) — unit tests with an injected
 * SqlClient. Regression coverage for the token-service audit findings:
 *   - case-insensitive address lookup (getToken must not 404 a checksummed
 *     token queried in different casing),
 *   - listTokens limit clamping (negative / NaN limits must not produce an
 *     unbounded result set or a 500),
 *   - upsertToken write-failure propagation (a failed D1 write must surface
 *     as TokenWriteError, never a silent success),
 *   - chain scoping of every read.
 */

import { Effect, Layer } from "effect"
import { SqlClient } from "effect/unstable/sql"
import { describe, expect, it } from "vitest"
import { TokenService, TokenServiceDeps, TokenServiceLive, TokenWriteError } from "../../src/services/token.service"

// EIP-55 checksummed address (USDC)
const USDC = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48"

type RowHandler = (params: readonly unknown[], sqlText: string) => Effect.Effect<readonly Record<string, unknown>[]>

/**
 * Statement-aware in-memory SqlClient. Routes on SQL fragments from the joined
 * template text (values arrive as bound params) and simulates the small slice
 * of SQLite semantics these tests assert: negative LIMIT → no cap, non-finite
 * LIMIT → query error, LOWER() matching on addresses.
 */
function sqlRouterLayer(routes: Record<string, RowHandler>) {
  const call = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.reduce((acc, part, i) => acc + part + (i < strings.length - 1 ? `$${i + 1}` : ""), "")
    const handler = Object.entries(routes).find(([fragment]) => text.includes(fragment))?.[1]
    return handler ? handler(values, text) : Effect.succeed([] as readonly Record<string, unknown>[])
  }
  const fn = Object.assign(call, { unsafe: (s: string) => s })
  return Layer.succeed(SqlClient.SqlClient, fn as unknown as SqlClient.SqlClient)
}

const makeService = (routes: Record<string, RowHandler>, chainId = 1) =>
  TokenServiceLive.pipe(
    Layer.provide(sqlRouterLayer(routes)),
    Layer.provide(Layer.succeed(TokenServiceDeps, { chainId })),
  )

const usdcRow = {
  chain_id: 1,
  address: USDC,
  symbol: "USDC",
  name: "USD Coin",
  decimals: 6,
  logo_url: null,
  is_verified: 1,
  is_native: 0,
  total_supply: null,
  created_at: 1,
  updated_at: 1,
}

const run = <A>(effect: Effect.Effect<A, never, never>, layer: Layer.Layer<never, never, never>) =>
  Effect.runPromise(effect.pipe(Effect.provide(layer)))

describe("TokenService.getToken", () => {
  it("matches a checksummed address queried in different casing (case-insensitive)", async () => {
    const layer = makeService({
      // Only the LOWER(address)-keyed query (the fixed contract) serves rows; the
      // old case-sensitive `address = ${address}` query matches no route → miss.
      "LOWER(address)": () => Effect.succeed([usdcRow]),
    })
    const token = await run(
      Effect.gen(function* () {
        const svc = yield* TokenService
        return yield* svc.getToken(USDC.toLowerCase())
      }),
      layer,
    )
    expect(token?.address).toBe(USDC)
    expect(token?.symbol).toBe("USDC")
  })

  it("scopes the lookup to the configured chain", async () => {
    const seenChainIds: unknown[] = []
    const layer = makeService({
      "LOWER(address)": (params) => {
        seenChainIds.push(params[1])
        return Effect.succeed([])
      },
    })
    await run(
      Effect.gen(function* () {
        const svc = yield* TokenService
        return yield* svc.getToken(USDC)
      }),
      layer,
    )
    expect(seenChainIds).toEqual([1])
  })
})

describe("TokenService.listTokens", () => {
  const rows = Array.from({ length: 600 }, (_, i) => ({
    chain_id: 1,
    address: `0x${(i + 1).toString(16).padStart(40, "0")}`,
    symbol: `T${i}`,
    name: `Token ${i}`,
    decimals: 18,
    logo_url: null,
    is_verified: 0,
    is_native: 0,
    total_supply: null,
    created_at: 1,
    updated_at: 1,
  }))

  it("clamps negative and NaN limits to the default (100) instead of an unbounded set or a 500", async () => {
    const seenLimits: unknown[] = []
    const layer = makeService({
      "FROM tokens": (params, _text) => {
        // LIMIT is always the last bound parameter in every listTokens branch.
        const limit = params[params.length - 1]
        seenLimits.push(limit)
        // SQLite semantics: a non-finite LIMIT errors; a negative LIMIT means "no limit".
        if (typeof limit === "number" && !Number.isFinite(limit)) {
          return Effect.fail(new Error(`LIMIT ${limit}`))
        }
        return Effect.succeed(typeof limit === "number" && limit >= 0 ? rows.slice(0, limit) : rows)
      },
    })
    const list = (options?: { limit?: number }) =>
      Effect.gen(function* () {
        const svc = yield* TokenService
        return yield* svc.listTokens(options)
      })

    const nanResult = await run(list({ limit: Number.NaN }), layer)
    expect(nanResult).toHaveLength(100)
    const negativeResult = await run(list({ limit: -1 }), layer)
    expect(negativeResult).toHaveLength(100)
    const hugeResult = await run(list({ limit: 10_000 }), layer)
    expect(hugeResult).toHaveLength(500)
    expect(seenLimits).toEqual([100, 100, 500])
  })
})

describe("TokenService.upsertToken", () => {
  const token = {
    chainId: 1,
    address: USDC,
    symbol: "USDC",
    name: "USD Coin",
    decimals: 6,
    logoUrl: null,
    isVerified: true,
    isNative: false,
    totalSupply: null,
  }

  it("propagates a D1 write failure as TokenWriteError instead of resolving undefined", async () => {
    const layer = makeService({
      "INSERT INTO tokens": () => Effect.fail(new Error("D1 constraint violation")),
    })
    const failure = await Effect.runPromise(
      Effect.flip(
        Effect.gen(function* () {
          const svc = yield* TokenService
          yield* svc.upsertToken(token)
        }).pipe(Effect.provide(layer)),
      ),
    )
    expect(failure).toBeInstanceOf(TokenWriteError)
    expect((failure as TokenWriteError).cause).toContain("D1 constraint violation")
  })

  it("includes is_native in the ON CONFLICT update so a corrected native flag persists", async () => {
    let upsertSql = ""
    const layer = makeService({
      "INSERT INTO tokens": (_params, text) => {
        upsertSql = text
        return Effect.succeed([])
      },
    })
    await run(
      Effect.gen(function* () {
        const svc = yield* TokenService
        yield* svc.upsertToken(token)
      }),
      layer,
    )
    expect(upsertSql).toContain("is_native = excluded.is_native")
  })
})
