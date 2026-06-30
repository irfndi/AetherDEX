/**
 * AetherDEX Pool Service
 * Reads from D1 for indexed pool data + composes with on-chain V4 reads
 */

import { Context, Effect, Layer } from "effect"

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
  readonly getPoolByTokens: (
    token0: string,
    token1: string,
    fee: number,
  ) => Effect.Effect<PoolInfo | null>
  readonly refreshPool: (poolId: string) => Effect.Effect<PoolInfo>
}

// --- Tag ---

export const PoolService = Context.GenericTag<PoolService>("@aetherdex/PoolService")

// --- Default stub implementation (T17/T18 wires real logic) ---

const makePoolService = (): PoolService => ({
  getPool: (_poolId: string) => Effect.succeed(null),
  listPools: (_options?: PoolQueryOptions) => Effect.succeed([]),
  getPoolByTokens: (_token0: string, _token1: string, _fee: number) =>
    Effect.succeed(null),
  refreshPool: (_poolId: string) =>
    Effect.die(new Error("PoolService.refreshPool not implemented")),
})

// --- Live layer ---

export const PoolServiceLive = Layer.succeed(PoolService, makePoolService())
