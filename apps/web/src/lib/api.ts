import {
  type PoolListResponse,
  PoolListResponseSchema,
  type TokenListResponse,
  TokenListResponseSchema,
  type TokenResponse,
  TokenResponseSchema,
} from "@aetherdex/shared"
import { Effect, Schema } from "effect"

export const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:8080/api/v1"

export interface ListPoolsOptions {
  sortBy?: "tvl" | "volume" | "fees" | "created"
  sortDirection?: "asc" | "desc"
  filterToken?: string | undefined
  signal?: AbortSignal | undefined
}

export function listPools(limit = 50, offset = 0, options: ListPoolsOptions = {}) {
  return Effect.gen(function* () {
    const params = new URLSearchParams({
      limit: String(limit),
      offset: String(offset),
      sortBy: options.sortBy ?? "tvl",
      sortDirection: options.sortDirection ?? "desc",
    })
    if (options.filterToken) {
      params.set("filterToken", options.filterToken)
    }
    const res = yield* Effect.tryPromise({
      try: () => fetch(`${API_URL}/pools?${params.toString()}`, { signal: options.signal ?? null }),
      catch: (e) => new Error(`Pools fetch failed: ${String(e)}`),
    })
    const json: unknown = yield* Effect.tryPromise({
      try: () => res.json(),
      catch: (e) => new Error(`Pools parse failed: ${String(e)}`),
    })
    return yield* Schema.decodeUnknownEffect(PoolListResponseSchema)(json)
  })
}

export type { PoolListResponse }

export interface FetchTokensOptions {
  query?: string
  limit?: number
  signal?: AbortSignal | undefined
}

/**
 * Tokens from the canonical Uniswap default token list (server-validated:
 * schema + EIP-55 checksums + chainId filter). No custom lists.
 */
export function fetchTokens(options: FetchTokensOptions = {}) {
  return Effect.gen(function* () {
    const params = new URLSearchParams({ limit: String(options.limit ?? 100) })
    if (options.query) {
      params.set("search", options.query)
    }
    const res = yield* Effect.tryPromise({
      try: () => fetch(`${API_URL}/tokens?${params.toString()}`, { signal: options.signal ?? null }),
      catch: (e) => new Error(`Tokens fetch failed: ${String(e)}`),
    })
    const json: unknown = yield* Effect.tryPromise({
      try: () => res.json(),
      catch: (e) => new Error(`Tokens parse failed: ${String(e)}`),
    })
    return yield* Schema.decodeUnknownEffect(TokenListResponseSchema)(json)
  })
}

export function fetchTokenByAddress(address: string, signal?: AbortSignal) {
  return Effect.gen(function* () {
    const res = yield* Effect.tryPromise({
      try: () => fetch(`${API_URL}/tokens/${address}`, { signal: signal ?? null }),
      catch: (e) => new Error(`Token fetch failed: ${String(e)}`),
    })
    if (res.status === 404) {
      return null
    }
    if (!res.ok) {
      return yield* Effect.fail(new Error(`Token fetch failed: HTTP ${res.status}`))
    }
    const json: unknown = yield* Effect.tryPromise({
      try: () => res.json(),
      catch: (e) => new Error(`Token parse failed: ${String(e)}`),
    })
    const decoded = yield* Schema.decodeUnknownEffect(TokenResponseSchema)(json)
    return decoded.token
  })
}

export type { TokenListResponse, TokenResponse }
