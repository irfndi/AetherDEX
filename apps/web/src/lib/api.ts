import { type PoolListResponse, PoolListResponseSchema } from "@aetherdex/shared"
import { Effect, Schema } from "effect"

export const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:8080/api/v1"

export function listPools(limit = 50, offset = 0) {
  return Effect.gen(function* () {
    const params = new URLSearchParams({
      limit: String(limit),
      offset: String(offset),
      sortBy: "tvl",
      sortDirection: "desc",
    })
    const res = yield* Effect.tryPromise({
      try: () => fetch(`${API_URL}/pools?${params.toString()}`),
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
