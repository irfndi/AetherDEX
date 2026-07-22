import { Schema } from "effect"

export const PoolSchema = Schema.Struct({
  poolId: Schema.String,
  token0Address: Schema.String,
  token1Address: Schema.String,
  fee: Schema.Number,
  tickSpacing: Schema.Number,
  hookAddress: Schema.NullOr(Schema.String),
  sqrtPriceX96: Schema.String,
  currentTick: Schema.Number,
  liquidity: Schema.String,
  tvlUsd: Schema.Number,
  volume24hUsd: Schema.Number,
  fees24hUsd: Schema.Number,
  isActive: Schema.Boolean,
  createdAt: Schema.Number,
  updatedAt: Schema.Number,
})

export type Pool = typeof PoolSchema.Type

export const ListPoolsPayloadSchema = Schema.Struct({
  limit: Schema.optional(Schema.Number),
  offset: Schema.optional(Schema.Number),
})

export type ListPoolsPayload = typeof ListPoolsPayloadSchema.Type

export const PoolListResponseSchema = Schema.Struct({
  pools: Schema.Array(PoolSchema),
  count: Schema.Number,
})

export type PoolListResponse = typeof PoolListResponseSchema.Type
