/**
 * AetherDEX Token List Service — Phase 0 G4
 *
 * Serves the canonical Uniswap default token list (fetched + validated:
 * schema + EIP-55 checksums + chainId filter). The D1 `tokens` table is used
 * strictly as a write-through CACHE of that list (fallback when the upstream
 * fetch fails) — never a separately curated source.
 */

import { Context, Effect, Layer } from "effect"
import { SqlClient } from "effect/unstable/sql"
import { rowToToken } from "../db/schema"
import { TokenListValidationError, type ValidatedToken, validateTokenList } from "../lib/token-list"
import type { TokenInfo } from "./token.service"

// --- Errors ---

export class TokenListFetchError {
  readonly _tag = "TokenListFetchError"
  constructor(readonly cause: string) {}
}

export class TokenListError {
  readonly _tag = "TokenListError"
  constructor(readonly cause: string) {}
}

// --- Fetcher (HTTP abstracted so tests inject a fixed document) ---

export interface TokenListFetcher {
  readonly fetchList: () => Effect.Effect<unknown, TokenListFetchError>
}

export const TokenListFetcher = Context.Service<TokenListFetcher>("@aetherdex/TokenListFetcher")

export const makeTokenListFetcherLayer = (url: string): Layer.Layer<TokenListFetcher> =>
  Layer.succeed(TokenListFetcher, {
    fetchList: () =>
      Effect.tryPromise({
        try: async () => {
          const res = await fetch(url, {
            headers: { Accept: "application/json" },
            signal: AbortSignal.timeout(15_000),
          })
          if (!res.ok) throw new Error(`Token list HTTP ${res.status}`)
          return (await res.json()) as unknown
        },
        catch: (e) => new TokenListFetchError(e instanceof Error ? e.message : String(e)),
      }),
  })

// --- Dependencies ---

export interface TokenListServiceDeps {
  readonly kv: KVNamespace
  readonly chainId: number
  /** KV cache TTL for the validated list (seconds). */
  readonly cacheTtlSeconds: number
}

export const TokenListServiceDeps = Context.Service<TokenListServiceDeps>("@aetherdex/TokenListServiceDeps")

// --- Service interface ---

export interface TokenSearchOptions {
  readonly query?: string
  readonly verified?: boolean
  readonly limit?: number
}

export interface TokenListService {
  readonly listTokens: (options?: TokenSearchOptions) => Effect.Effect<TokenInfo[], TokenListError>
  readonly getToken: (address: string) => Effect.Effect<TokenInfo | null, TokenListError>
  /** Re-fetch the default list, validate, and refresh the KV + D1 caches. */
  readonly refresh: () => Effect.Effect<TokenInfo[], TokenListError>
}

export const TokenListService = Context.Service<TokenListService>("@aetherdex/TokenListService")

// --- Helpers ---

const kvKey = (chainId: number) => `token-list:v1:chain:${chainId}`

function toTokenInfo(token: ValidatedToken): TokenInfo {
  return {
    address: token.address,
    symbol: token.symbol,
    name: token.name,
    decimals: token.decimals,
    logoUrl: token.logoURI,
    isVerified: true,
    isNative: false,
    totalSupply: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }
}

function matchesQuery(token: TokenInfo, query: string | undefined): boolean {
  if (!query || query.length < 1) return true
  const q = query.toLowerCase()
  return (
    token.symbol.toLowerCase().includes(q) || token.name.toLowerCase().includes(q) || token.address.toLowerCase() === q
  )
}

// --- Implementation ---

const makeTokenListService = Effect.gen(function* () {
  const deps = yield* TokenListServiceDeps
  const fetcher = yield* TokenListFetcher
  const sql = yield* SqlClient.SqlClient

  const readCache = (): Effect.Effect<TokenInfo[] | null, TokenListError> =>
    Effect.tryPromise({
      try: async () => {
        const raw = await deps.kv.get(kvKey(deps.chainId))
        if (!raw) return null
        const parsed = JSON.parse(raw) as ValidatedToken[]
        if (!Array.isArray(parsed)) return null
        return parsed.map(toTokenInfo)
      },
      catch: (e) => new TokenListError(`KV cache read failed: ${String(e)}`),
    })

  const writeThroughD1 = (tokens: readonly ValidatedToken[]): Effect.Effect<void, never> =>
    Effect.forEach(
      tokens,
      (token) =>
        sql`
          INSERT INTO tokens (address, symbol, name, decimals, logo_url, is_verified, is_native, total_supply, created_at, updated_at)
          VALUES (${token.address}, ${token.symbol}, ${token.name}, ${token.decimals}, ${token.logoURI}, 1, 0, NULL, ${Date.now()}, ${Date.now()})
          ON CONFLICT(address) DO UPDATE SET
            symbol = excluded.symbol,
            name = excluded.name,
            decimals = excluded.decimals,
            logo_url = excluded.logo_url,
            is_verified = 1,
            updated_at = excluded.updated_at
        `,
      { concurrency: 20 },
    ).pipe(
      Effect.asVoid,
      Effect.catch(() => Effect.void),
    )

  const refresh = (): Effect.Effect<TokenInfo[], TokenListError> =>
    Effect.gen(function* () {
      const doc = yield* fetcher
        .fetchList()
        .pipe(Effect.mapError((e) => new TokenListError(`Token list fetch failed: ${e.cause}`)))

      let tokens: readonly ValidatedToken[]
      try {
        tokens = validateTokenList(doc, deps.chainId)
      } catch (e) {
        const message = e instanceof TokenListValidationError ? e.message : String(e)
        return yield* Effect.fail(new TokenListError(`Token list validation failed: ${message}`))
      }

      yield* Effect.tryPromise({
        try: () => deps.kv.put(kvKey(deps.chainId), JSON.stringify(tokens), { expirationTtl: deps.cacheTtlSeconds }),
        catch: () => undefined,
      }).pipe(Effect.catch(() => Effect.void))

      yield* writeThroughD1(tokens)

      return tokens.map(toTokenInfo)
    })

  const readD1Cache = (): Effect.Effect<TokenInfo[], never> =>
    sql`
      SELECT * FROM tokens
      WHERE is_verified = 1
      ORDER BY symbol ASC
      LIMIT 500
    `
      .pipe(Effect.map((rows) => rows.map((r) => rowToToken(r as Record<string, unknown>))))
      .pipe(Effect.catch(() => Effect.succeed([] as TokenInfo[])))

  const applyOptions = (tokens: readonly TokenInfo[], options?: TokenSearchOptions): TokenInfo[] =>
    tokens.filter((t) => matchesQuery(t, options?.query)).slice(0, Math.min(options?.limit ?? 100, 500))

  /** KV cache → fresh fetch (re-caching) → D1 cache; fail only if all miss. */
  const resolveTokens = (): Effect.Effect<TokenInfo[], TokenListError> =>
    Effect.gen(function* () {
      // A cache read failure is a cache miss, not a hard failure.
      const cached = yield* readCache().pipe(Effect.catch(() => Effect.succeed(null)))
      if (cached) return cached

      return yield* refresh().pipe(
        Effect.catch((fetchErr) =>
          Effect.gen(function* () {
            const d1Cache = yield* readD1Cache()
            if (d1Cache.length > 0) return d1Cache
            return yield* Effect.fail(new TokenListError(`Token list unavailable: ${fetchErr.cause}`))
          }),
        ),
      )
    })

  const listTokens = (options?: TokenSearchOptions): Effect.Effect<TokenInfo[], TokenListError> =>
    Effect.gen(function* () {
      const tokens = yield* resolveTokens()
      return applyOptions(tokens, options)
    })

  const getToken = (address: string): Effect.Effect<TokenInfo | null, TokenListError> =>
    Effect.gen(function* () {
      const tokens = yield* resolveTokens()
      const lower = address.toLowerCase()
      return tokens.find((t) => t.address.toLowerCase() === lower) ?? null
    })

  return { listTokens, getToken, refresh }
})

export const TokenListServiceLive = Layer.effect(TokenListService, makeTokenListService)
