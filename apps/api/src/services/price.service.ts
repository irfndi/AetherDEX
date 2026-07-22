/**
 * AetherDEX Price Service
 * Multi-source price feed with fallback chain: KV → D1 → CoinGecko → DexScreener
 */

import { Context, Effect, Layer, Option } from "effect"

// --- Types ---

export interface PriceData {
  tokenAddress: string
  priceUsd: number
  source: "kv-cache" | "d1-cache" | "coingecko" | "dexscreener"
  confidence?: number
  updatedAt: number
}

// --- Errors ---

export class PriceFetchError {
  readonly _tag = "PriceFetchError"
  constructor(
    readonly tokenAddress: string,
    readonly cause: string,
  ) {}
}

// --- Service interface (unchanged) ---

export interface PriceService {
  readonly getPrice: (tokenAddress: string) => Effect.Effect<PriceData, PriceFetchError>
  readonly getPrices: (tokenAddresses: string[]) => Effect.Effect<PriceData[], PriceFetchError>
  readonly refreshPrice: (tokenAddress: string) => Effect.Effect<PriceData, PriceFetchError>
}

// --- Tag ---

export const PriceService = Context.Service<PriceService>("@aetherdex/PriceService")

// --- Dependencies (KV + D1 bindings injected via Layer) ---

export interface PriceServiceDeps {
  kv: KVNamespace
  db: D1Database
}

export const PriceServiceDeps = Context.Service<PriceServiceDeps>("@aetherdex/PriceServiceDeps")

// --- Constants ---

const KV_TTL_SECONDS = 60
const D1_FRESHNESS_MS = 5 * 60 * 1000 // 5 minutes

// --- CoinGecko fetch ---

function fetchFromCoinGecko(tokenAddress: string): Effect.Effect<PriceData, PriceFetchError> {
  return Effect.tryPromise({
    try: async () => {
      const url = `https://api.coingecko.com/api/v3/simple/token_price/ethereum?contract_addresses=${tokenAddress}&vs_currencies=usd&include_24hr_change=false`
      const res = await fetch(url, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(10_000),
      })
      if (!res.ok) {
        throw new Error(`CoinGecko HTTP ${res.status}`)
      }
      const data = (await res.json()) as Record<string, { usd?: number }>
      const entry = data[tokenAddress.toLowerCase()]
      const price = entry?.usd
      if (price === undefined || price === null || price <= 0) {
        throw new Error(`CoinGecko returned no price for ${tokenAddress}`)
      }
      return {
        tokenAddress,
        priceUsd: price,
        source: "coingecko" as const,
        updatedAt: Date.now(),
      }
    },
    catch: (e) =>
      new PriceFetchError(tokenAddress, `CoinGecko fetch failed: ${e instanceof Error ? e.message : String(e)}`),
  })
}

// --- DexScreener fetch ---

function fetchFromDexScreener(tokenAddress: string): Effect.Effect<PriceData, PriceFetchError> {
  return Effect.tryPromise({
    try: async () => {
      const url = `https://api.dexscreener.com/latest/dex/tokens/${tokenAddress}`
      const res = await fetch(url, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(10_000),
      })
      if (!res.ok) {
        throw new Error(`DexScreener HTTP ${res.status}`)
      }
      const data = (await res.json()) as {
        pairs?: Array<{ priceUsd?: string }>
      }
      const pairs = data.pairs
      if (!pairs || pairs.length === 0) {
        throw new Error(`DexScreener has no pairs for ${tokenAddress}`)
      }
      const price = Number.parseFloat(pairs[0]?.priceUsd ?? "0")
      if (!price || price <= 0) {
        throw new Error(`DexScreener returned invalid price for ${tokenAddress}`)
      }
      return {
        tokenAddress,
        priceUsd: price,
        source: "dexscreener" as const,
        updatedAt: Date.now(),
      }
    },
    catch: (e) =>
      new PriceFetchError(tokenAddress, `DexScreener fetch failed: ${e instanceof Error ? e.message : String(e)}`),
  })
}

// --- D1 cache read/write ---

function readD1Price(db: D1Database, tokenAddress: string): Effect.Effect<Option.Option<PriceData>, never> {
  return Effect.tryPromise({
    try: async () => {
      const row = await db
        .prepare("SELECT price_usd, updated_at FROM price_cache WHERE token_address = ?")
        .bind(tokenAddress)
        .first<{ price_usd: number; updated_at: number }>()
      if (!row) return Option.none<PriceData>()
      const rowUpdatedAtMs = row.updated_at > 1e12 ? row.updated_at : row.updated_at * 1000
      const age = Date.now() - rowUpdatedAtMs
      if (age > D1_FRESHNESS_MS) return Option.none<PriceData>()
      return Option.some({
        tokenAddress,
        priceUsd: row.price_usd,
        source: "d1-cache" as const,
        updatedAt: row.updated_at * 1000,
      })
    },
    catch: () => Option.none<PriceData>(),
  }) as Effect.Effect<Option.Option<PriceData>, never, never>
}

function writeD1Price(db: D1Database, data: PriceData): Effect.Effect<void, never> {
  return Effect.tryPromise({
    try: async () => {
      const ts = Math.floor(data.updatedAt / 1000)
      await db
        .prepare(
          "INSERT INTO price_cache (token_address, price_usd, updated_at) VALUES (?, ?, ?) ON CONFLICT(token_address) DO UPDATE SET price_usd = excluded.price_usd, updated_at = excluded.updated_at",
        )
        .bind(data.tokenAddress, data.priceUsd, ts)
        .run()
    },
    catch: () => undefined, // best-effort — don't fail the caller
  })
    .pipe(Effect.asVoid)
    .pipe(Effect.catch(() => Effect.succeed(undefined)))
}

// --- KV cache read/write ---

function readKvPrice(kv: KVNamespace, tokenAddress: string): Effect.Effect<Option.Option<PriceData>, never> {
  return Effect.tryPromise({
    try: async () => {
      const raw = await kv.get(`price:${tokenAddress}`)
      if (!raw) return Option.none<PriceData>()
      const entry = JSON.parse(raw) as { priceUsd: number; updatedAt: number }
      return Option.some({
        tokenAddress,
        priceUsd: entry.priceUsd,
        source: "kv-cache" as const,
        updatedAt: entry.updatedAt,
      })
    },
    catch: () => Option.none<PriceData>(),
  }).pipe(Effect.catch(() => Effect.succeed(Option.none<PriceData>() as Option.Option<PriceData>)))
}

function writeKvPrice(kv: KVNamespace, data: PriceData): Effect.Effect<void, never> {
  return Effect.tryPromise({
    try: async () => {
      await kv.put(
        `price:${data.tokenAddress}`,
        JSON.stringify({ priceUsd: data.priceUsd, updatedAt: data.updatedAt }),
        {
          expirationTtl: KV_TTL_SECONDS,
        },
      )
    },
    catch: () => undefined, // best-effort
  }).pipe(Effect.catch(() => Effect.succeed(undefined))) as Effect.Effect<void, never>
}

// --- Core: fetch from external sources and persist ---

function fetchExternalPrice(
  kv: KVNamespace,
  db: D1Database,
  tokenAddress: string,
): Effect.Effect<PriceData, PriceFetchError> {
  // Try CoinGecko first, fall back to DexScreener
  return fetchFromCoinGecko(tokenAddress).pipe(
    Effect.catch(() => fetchFromDexScreener(tokenAddress)),
    Effect.tap((data) => writeD1Price(db, data)),
    Effect.tap((data) => writeKvPrice(kv, data)),
  )
}

// --- Live implementation ---

const makePriceService = (deps: PriceServiceDeps): PriceService => {
  const { kv, db } = deps

  return {
    getPrice: (tokenAddress: string): Effect.Effect<PriceData, PriceFetchError> =>
      Effect.gen(function* () {
        // 1. Check KV cache (60s TTL)
        const kvHit = yield* readKvPrice(kv, tokenAddress)
        if (Option.isSome(kvHit)) return kvHit.value

        // 2. Check D1 cache (5min freshness)
        const d1Hit = yield* readD1Price(db, tokenAddress)
        if (Option.isSome(d1Hit)) {
          // Backfill KV for next time
          yield* writeKvPrice(kv, d1Hit.value)
          return d1Hit.value
        }

        // 3. Fetch from external sources
        return yield* fetchExternalPrice(kv, db, tokenAddress)
      }),

    getPrices: (tokenAddresses: string[]): Effect.Effect<PriceData[], PriceFetchError> =>
      Effect.forEach(tokenAddresses, (addr) => fetchPriceWithFallback(kv, db, addr), {
        concurrency: 10,
      }),

    refreshPrice: (tokenAddress: string): Effect.Effect<PriceData, PriceFetchError> =>
      // Bypass all caches — force fresh fetch
      fetchExternalPrice(kv, db, tokenAddress),
  }
}

/**
 * Single-token fetch that tries KV → D1 → external, used by getPrices.
 * Identical logic to getPrice but extracted to avoid circular refs.
 */
function fetchPriceWithFallback(
  kv: KVNamespace,
  db: D1Database,
  tokenAddress: string,
): Effect.Effect<PriceData, PriceFetchError> {
  return Effect.gen(function* () {
    const kvHit = yield* readKvPrice(kv, tokenAddress)
    if (Option.isSome(kvHit)) return kvHit.value

    const d1Hit = yield* readD1Price(db, tokenAddress)
    if (Option.isSome(d1Hit)) {
      yield* writeKvPrice(kv, d1Hit.value)
      return d1Hit.value
    }

    return yield* fetchExternalPrice(kv, db, tokenAddress)
  })
}

// --- Live layer ---

export const PriceServiceLive = Layer.effect(
  PriceService,
  Effect.gen(function* () {
    const deps = yield* PriceServiceDeps
    return makePriceService(deps)
  }),
)
