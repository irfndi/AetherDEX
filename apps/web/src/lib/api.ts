import { type PoolListResponse, PoolListResponseSchema } from "@aetherdex/shared"
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
