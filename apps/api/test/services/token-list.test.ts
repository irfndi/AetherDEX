/**
 * Phase-0 G4 — Uniswap default token list: validation + checksum + chainId
 * filtering + KV/D1 cache behavior.
 */

import { Effect, Layer } from "effect"
import { SqlClient } from "effect/unstable/sql"
import { getAddress } from "viem"
import { beforeEach, describe, expect, it } from "vitest"
import { TokenListValidationError, validateTokenList } from "../../src/lib/token-list"
import {
  TokenListServiceDeps as DepsTag,
  TokenListFetcher as FetcherTag,
  type TokenListFetcher,
  TokenListService,
  TokenListServiceLive,
} from "../../src/services/token-list.service"

// Checksum-correct addresses (EIP-55)
const USDC = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48"
const WETH = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2"
const DAI = "0x6B175474E89094C44Da98b954EedeAC495271d0F"

const goodDoc = {
  name: "Uniswap Labs Default",
  tokens: [
    { chainId: 1, address: USDC, symbol: "USDC", name: "USD Coin", decimals: 6, logoURI: "https://logo/usdc.png" },
    { chainId: 1, address: WETH, symbol: "WETH", name: "Wrapped Ether", decimals: 18 },
    { chainId: 10, address: DAI, symbol: "DAI", name: "Dai Stablecoin", decimals: 18 },
    { chainId: 1, address: DAI, symbol: "DAI", name: "Dai Stablecoin", decimals: 18 },
  ],
}

describe("validateTokenList", () => {
  it("validates schema and filters to the requested chainId", () => {
    const tokens = validateTokenList(goodDoc, 1)
    expect(tokens.map((t) => t.symbol).sort()).toEqual(["DAI", "USDC", "WETH"])
    expect(tokens.every((t) => t.chainId === 1)).toBe(true)
    expect(tokens.find((t) => t.symbol === "USDC")?.logoURI).toBe("https://logo/usdc.png")
    expect(tokens.find((t) => t.symbol === "WETH")?.logoURI).toBeNull()
  })

  it("keeps EIP-55 checksummed addresses and drops bad checksums", () => {
    const badChecksum = "0xa0b86991C6218b36c1d19D4a2e9Eb0cE3606eB48" // valid lowercase mangled into invalid mixed case
    const tokens = validateTokenList(
      { tokens: [{ chainId: 1, address: badChecksum, symbol: "X", name: "Bad", decimals: 18 }] },
      1,
    )
    expect(tokens).toEqual([])

    const lower = validateTokenList(
      { tokens: [{ chainId: 1, address: USDC.toLowerCase(), symbol: "USDC", name: "USD Coin", decimals: 6 }] },
      1,
    )
    expect(lower).toHaveLength(1)
    expect(lower[0]?.address).toBe(getAddress(USDC)) // normalized to checksum
  })

  it("drops entries with invalid decimals / missing fields", () => {
    const tokens = validateTokenList(
      {
        tokens: [
          { chainId: 1, address: USDC, symbol: "USDC", name: "USD Coin", decimals: 300 },
          { chainId: 1, address: WETH, symbol: "", name: "Blank symbol", decimals: 18 },
          { chainId: 1, address: DAI, decimals: 18 },
          { chainId: 1, address: USDC, symbol: "DUP", name: "Duplicate address", decimals: 6 },
        ],
      },
      1,
    )
    expect(tokens.map((t) => t.symbol)).toEqual(["DUP"])
  })

  it("fails on a structurally invalid document", () => {
    expect(() => validateTokenList({ notTokens: [] }, 1)).toThrow(TokenListValidationError)
    expect(() => validateTokenList(null, 1)).toThrow(TokenListValidationError)
    expect(() => validateTokenList("nope", 1)).toThrow(TokenListValidationError)
  })
})

// ─── In-memory fakes ─────────────────────────────────────────────────────────

function fakeKv() {
  const store = new Map<string, string>()
  return {
    store,
    kv: {
      get: (key: string) => Promise.resolve(store.get(key) ?? null),
      put: (key: string, value: string, _opts?: unknown) => {
        store.set(key, value)
        return Promise.resolve()
      },
    } as unknown as KVNamespace,
  }
}

const fakeSqlLayer = (rows: ReadonlyArray<unknown> = []) => {
  const fn = Object.assign((..._parts: ReadonlyArray<unknown>) => Effect.succeed(rows), {
    unsafe: (s: string) => s,
  })
  return Layer.succeed(SqlClient.SqlClient, fn as unknown as SqlClient.SqlClient)
}

const mockFetcherLayer = (doc: unknown): { layer: Layer.Layer<TokenListFetcher>; calls: () => number } => {
  let count = 0
  const fetcher: TokenListFetcher = {
    fetchList: () =>
      Effect.sync(() => {
        count += 1
        return doc
      }),
  }
  return { layer: Layer.succeed(FetcherTag, fetcher), calls: () => count }
}

const failingFetcherLayer = () => {
  const fetcher: TokenListFetcher = {
    fetchList: () => Effect.fail({ _tag: "TokenListFetchError" as const, cause: "network down" }),
  }
  return Layer.succeed(FetcherTag, fetcher)
}

const serviceLayer = (
  fetcherLayer: Layer.Layer<TokenListFetcher>,
  kv: KVNamespace,
  d1Rows: ReadonlyArray<unknown> = [],
) =>
  TokenListServiceLive.pipe(
    Layer.provide(fetcherLayer),
    Layer.provide(fakeSqlLayer(d1Rows)),
    Layer.provide(Layer.succeed(DepsTag, { kv, chainId: 1, cacheTtlSeconds: 3600 })),
  )

const listTokens = (layer: ReturnType<typeof serviceLayer>) =>
  Effect.gen(function* () {
    const svc = yield* TokenListService
    return yield* svc.listTokens()
  }).pipe(Effect.provide(layer))

describe("TokenListService", () => {
  beforeEach(() => {
    // fresh state per test via local fakes
  })

  it("lists validated, chainId-filtered tokens from the default list", async () => {
    const { kv } = fakeKv()
    const fetcher = mockFetcherLayer(goodDoc)
    const tokens = await Effect.runPromise(listTokens(serviceLayer(fetcher.layer, kv)))
    expect(tokens.map((t) => t.symbol).sort()).toEqual(["DAI", "USDC", "WETH"])
    expect(tokens.every((t) => t.isVerified)).toBe(true)
    expect(fetcher.calls()).toBe(1)
  })

  it("serves subsequent reads from the KV cache (no re-fetch)", async () => {
    const { kv, store } = fakeKv()
    const fetcher = mockFetcherLayer(goodDoc)
    const layer = serviceLayer(fetcher.layer, kv)
    await Effect.runPromise(listTokens(layer))
    await Effect.runPromise(listTokens(layer))
    expect(fetcher.calls()).toBe(1)
    expect(store.size).toBe(1)
  })

  it("stamps timestamps once per refresh — cached reads never fabricate per-request timestamps", async () => {
    const { kv } = fakeKv()
    const fetcher = mockFetcherLayer(goodDoc)
    const layer = serviceLayer(fetcher.layer, kv)
    const first = await Effect.runPromise(listTokens(layer))
    const second = await Effect.runPromise(listTokens(layer))
    // Proof the second read came from the KV cache (and not a same-millisecond re-refresh):
    expect(fetcher.calls()).toBe(1)
    // Its stamps must equal the refresh time, not a fresh Date.now() minted at read time.
    expect(second.map((t) => t.updatedAt)).toEqual(first.map((t) => t.updatedAt))
    expect(second.every((t) => t.createdAt === t.updatedAt)).toBe(true)
  })

  it("filters by query against symbol/name/address", async () => {
    const { kv } = fakeKv()
    const fetcher = mockFetcherLayer(goodDoc)
    const tokens = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* TokenListService
        return yield* svc.listTokens({ query: "usd" })
      }).pipe(Effect.provide(serviceLayer(fetcher.layer, kv))),
    )
    expect(tokens.map((t) => t.symbol)).toEqual(["USDC"])
  })

  it("treats a non-finite limit as the default instead of slicing to an empty set", async () => {
    const { kv } = fakeKv()
    const fetcher = mockFetcherLayer(goodDoc)
    const layer = serviceLayer(fetcher.layer, kv)
    const nanTokens = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* TokenListService
        return yield* svc.listTokens({ limit: Number.NaN })
      }).pipe(Effect.provide(layer)),
    )
    expect(nanTokens.map((t) => t.symbol).sort()).toEqual(["DAI", "USDC", "WETH"])
    // A negative limit must not become slice(0, -n) (dropping the last entry) either.
    const negativeTokens = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* TokenListService
        return yield* svc.listTokens({ limit: -1 })
      }).pipe(Effect.provide(layer)),
    )
    expect(negativeTokens.map((t) => t.symbol).sort()).toEqual(["DAI", "USDC", "WETH"])
  })

  it("falls back to the D1 cache when the fetch fails", async () => {
    const { kv } = fakeKv()
    const d1Rows = [
      {
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
      },
    ]
    const tokens = await Effect.runPromise(listTokens(serviceLayer(failingFetcherLayer(), kv, d1Rows)))
    expect(tokens.map((t) => t.symbol)).toEqual(["USDC"])
    expect(tokens[0]?.chainId).toBe(1)
  })

  it("fails the Effect when fetch fails AND both caches are empty", async () => {
    const { kv } = fakeKv()
    const err = await Effect.runPromise(Effect.flip(listTokens(serviceLayer(failingFetcherLayer(), kv))))
    expect((err as { cause: string }).cause).toContain("Token list unavailable")
  })

  it("getToken resolves a checksummed address and misses unknown ones", async () => {
    const { kv } = fakeKv()
    const fetcher = mockFetcherLayer(goodDoc)
    const layer = serviceLayer(fetcher.layer, kv)
    const hit = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* TokenListService
        return yield* svc.getToken(USDC.toLowerCase())
      }).pipe(Effect.provide(layer)),
    )
    expect(hit?.symbol).toBe("USDC")
    const miss = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* TokenListService
        return yield* svc.getToken("0x0000000000000000000000000000000000000001")
      }).pipe(Effect.provide(layer)),
    )
    expect(miss).toBeNull()
  })
})

// ─── D1 fallback: source marker + uncapped getToken (write-through cache contract) ──

/**
 * Statement-aware SqlClient for the fallback tests: routes on fragments of the
 * joined template text (values arrive as bound params). The `source = 'token-list'`
 * fragment only exists in the FIXED queries, so an unfiltered route simulates the
 * old behavior and a filtered route simulates the new contract.
 */
const sqlRouterLayer = (routes: Record<string, (params: readonly unknown[]) => Effect.Effect<readonly unknown[]>>) => {
  const fn = Object.assign(
    (strings: TemplateStringsArray, ...values: unknown[]) => {
      const text = strings.reduce((acc, part, i) => acc + part + (i < strings.length - 1 ? `$${i + 1}` : ""), "")
      const handler = Object.entries(routes).find(([fragment]) => text.includes(fragment))?.[1]
      return handler ? handler(values) : Effect.succeed([] as readonly unknown[])
    },
    { unsafe: (s: string) => s },
  )
  return Layer.succeed(SqlClient.SqlClient, fn as unknown as SqlClient.SqlClient)
}

const fallbackServiceLayer = (
  routes: Record<string, (params: readonly unknown[]) => Effect.Effect<readonly unknown[]>>,
  kv: KVNamespace,
) =>
  TokenListServiceLive.pipe(
    Layer.provide(failingFetcherLayer()),
    Layer.provide(sqlRouterLayer(routes)),
    Layer.provide(Layer.succeed(DepsTag, { kv, chainId: 1, cacheTtlSeconds: 3600 })),
  )

describe("TokenListService D1 fallback (write-through cache contract)", () => {
  const baseRow = {
    chain_id: 1,
    symbol: "T0",
    name: "Token 0",
    decimals: 18,
    logo_url: null,
    is_verified: 1,
    is_native: 0,
    total_supply: null,
    created_at: 1,
    updated_at: 1,
  }

  it("serves only canonical (source='token-list') rows from the fallback — never user-curated rows", async () => {
    const { kv } = fakeKv()
    const table = [
      { ...baseRow, address: USDC, symbol: "USDC", source: "token-list" },
      { ...baseRow, address: WETH, symbol: "WETH", source: "user" }, // upsertToken row, is_verified = 1
    ]
    const layer = fallbackServiceLayer(
      {
        // FIXED query (has the source clause) → filtered; the OLD query text
        // (no source fragment) matches only the unfiltered route below.
        "source = 'token-list'": () => Effect.succeed(table.filter((r) => r.source === "token-list")),
        "ORDER BY symbol ASC": () => Effect.succeed(table),
      },
      kv,
    )
    const tokens = await Effect.runPromise(listTokens(layer))
    expect(tokens.map((t) => t.symbol)).toEqual(["USDC"])
  })

  it("getToken fallback resolves a canonical token beyond the 500-row cap via a direct D1 lookup", async () => {
    const { kv } = fakeKv()
    const targetAddress = `0x${"f".repeat(40)}`
    const table = [
      ...Array.from({ length: 600 }, (_, i) => ({
        ...baseRow,
        address: `0x${(i + 1).toString(16).padStart(40, "0")}`,
        symbol: `T${i}`,
        source: "token-list",
      })),
      { ...baseRow, address: targetAddress, symbol: "ZZZ", source: "token-list" }, // sorts beyond the 500th row
    ]
    const layer = fallbackServiceLayer(
      {
        // Capped materialization (old behavior): only the first 500 rows.
        "ORDER BY symbol ASC": () => Effect.succeed(table.slice(0, 500)),
        // Uncapped direct lookup by address (fixed behavior). The query binds
        // chain_id first, then the address: params = [chainId, address].
        "LOWER(address)": (params) => {
          const addr = String(params[1]).toLowerCase()
          const hit = table.find((r) => r.address.toLowerCase() === addr)
          return Effect.succeed(hit ? [hit] : [])
        },
      },
      kv,
    )
    const token = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* TokenListService
        return yield* svc.getToken(targetAddress.toLowerCase())
      }).pipe(Effect.provide(layer)),
    )
    expect(token?.symbol).toBe("ZZZ")
  })

  it("getToken fallback never serves a user-curated (source='user') row as canonical", async () => {
    const { kv } = fakeKv()
    const userRow = { ...baseRow, address: WETH, symbol: "WETH", source: "user" }
    const layer = fallbackServiceLayer(
      {
        // OLD query (no source clause) would serve the user row from the capped list.
        "ORDER BY symbol ASC": () => Effect.succeed([userRow]),
        // FIXED query applies the source clause before matching the address
        // (params = [chainId, address]).
        "LOWER(address)": (params) => {
          const addr = String(params[1]).toLowerCase()
          return Effect.succeed(
            userRow.address.toLowerCase() === addr && userRow.source === "token-list" ? [userRow] : [],
          )
        },
      },
      kv,
    )
    const token = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* TokenListService
        return yield* svc.getToken(WETH)
      }).pipe(Effect.provide(layer)),
    )
    expect(token).toBeNull()
  })
})
