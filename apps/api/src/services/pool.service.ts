/* @ts-nocheck */
/**
 * AetherDEX Pool Service
 * Reads from D1 for indexed pool data + composes with on-chain V4 reads
 */

import { SqlClient } from "@effect/sql"
import { Context, Effect, Layer } from "effect"
import { rowToPool } from "../db/schema"

// --- Types ---

export interface PoolInfo {
  poolId: string
  token0Address: string
  token1Address: string
  fee: number
  tickSpacing: number
  hookAddress: string | null
  sqrtPriceX96: string
  currentTick: number
  liquidity: string
  tvlUsd: number
  volume24hUsd: number
  fees24hUsd: number
  isActive: boolean
  createdAt: number
  updatedAt: number
}

export interface PoolQueryOptions {
  limit?: number
  offset?: number
  sortBy?: "tvl" | "volume" | "fees" | "created"
  sortDirection?: "asc" | "desc"
  filterByToken?: string
}

// --- Service interface ---

export interface PoolService {
  readonly getPool: (poolId: string) => Effect.Effect<PoolInfo | null>
  readonly listPools: (options?: PoolQueryOptions) => Effect.Effect<PoolInfo[]>
  readonly getPoolByTokens: (token0: string, token1: string, fee: number) => Effect.Effect<PoolInfo | null>
  readonly refreshPool: (poolId: string) => Effect.Effect<PoolInfo>
}

// --- Tag ---

export const PoolService = Context.GenericTag<PoolService>("@aetherdex/PoolService")

// --- D1-backed implementation ---

const makePoolService = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient

  const getPool = (poolId: string): Effect.Effect<PoolInfo | null, never, never> =>
    Effect.gen(function* () {
      const rows = (yield* sql`SELECT * FROM pools WHERE pool_id = ${poolId}`) as unknown as readonly Record<
        string,
        unknown
      >[]
      if (rows.length === 0) return null
      return rowToPool(rows[0] as Record<string, unknown>)
    }).pipe(Effect.catchAll(() => Effect.succeed(null as PoolInfo | null)))

  const listPools = (options?: PoolQueryOptions): Effect.Effect<PoolInfo[], never, never> =>
    Effect.gen(function* () {
      const limit = Math.min(options?.limit ?? 50, 200)
      const offset = options?.offset ?? 0
      const sortBy = options?.sortBy ?? "tvl"
      const sortDirection = options?.sortDirection ?? "desc"
      const filterByToken = options?.filterByToken

      const sortColumn: Record<string, string> = {
        tvl: "tvl_usd",
        volume: "volume_24h_usd",
        fees: "fees_24h_usd",
        created: "created_at",
      }
      const column = sortColumn[sortBy] ?? sortColumn.tvl
      const dir = sortDirection === "asc" ? "ASC" : "DESC"
      const col = column as string
      const direction = dir as string

      const rows = (yield* filterByToken
        ? sql`
          SELECT * FROM pools
          WHERE is_active = 1 AND (token0_address = ${filterByToken} OR token1_address = ${filterByToken})
          ORDER BY ${sql.unsafe(col)} ${sql.unsafe(direction)}
          LIMIT ${limit} OFFSET ${offset}
        `
        : sql`
          SELECT * FROM pools
          WHERE is_active = 1
          ORDER BY ${sql.unsafe(col)} ${sql.unsafe(direction)}
          LIMIT ${limit} OFFSET ${offset}
        `) as unknown as readonly Record<string, unknown>[]

      return rows.map((r: Record<string, unknown>) => rowToPool(r))
    }).pipe(Effect.catchAll(() => Effect.succeed([] as PoolInfo[])))

  const getPoolByTokens = (token0: string, token1: string, fee: number): Effect.Effect<PoolInfo | null, never, never> =>
    Effect.gen(function* () {
      const rows = (yield* sql`
        SELECT * FROM pools
        WHERE token0_address = ${token0} AND token1_address = ${token1} AND fee = ${fee}
        LIMIT 1
      `) as unknown as readonly Record<string, unknown>[]
      if (rows.length === 0) return null
      return rowToPool(rows[0] as Record<string, unknown>)
    }).pipe(Effect.catchAll(() => Effect.succeed(null as PoolInfo | null)))

  const refreshPool = (poolId: string): Effect.Effect<PoolInfo, never, never> =>
    Effect.gen(function* () {
      const rows = (yield* sql`SELECT * FROM pools WHERE pool_id = ${poolId}`) as unknown as readonly Record<
        string,
        unknown
      >[]
      if (rows.length === 0) return yield* Effect.die(new Error(`Pool ${poolId} not found`))
      return rowToPool(rows[0] as Record<string, unknown>)
    }).pipe(Effect.catchAll(() => Effect.die(new Error("D1 query failed"))))

  return PoolService.of({
    getPool,
    listPools,
    getPoolByTokens,
    refreshPool,
  }) as unknown as PoolService
})

// --- Live layer (requires SqlClient.SqlClient from D1) ---

export const PoolServiceLive = Layer.effect(PoolService, makePoolService)
