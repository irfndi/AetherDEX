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
