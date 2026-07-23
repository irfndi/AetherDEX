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

export type Pool = Schema.Schema.Type<typeof PoolSchema>

export const ListPoolsPayloadSchema = Schema.Struct({
  limit: Schema.optional(Schema.Number),
  offset: Schema.optional(Schema.Number),
})

export type ListPoolsPayload = Schema.Schema.Type<typeof ListPoolsPayloadSchema>

export const PoolListResponseSchema = Schema.Struct({
  pools: Schema.Array(PoolSchema),
  count: Schema.Number,
})

export type PoolListResponse = Schema.Schema.Type<typeof PoolListResponseSchema>

/**
 * Token metadata sourced from the canonical Uniswap default token list
 * (Phase-0 G4). The API validates the list (schema + EIP-55 checksums +
 * chainId filter) before serving.
 */
export const TokenSchema = Schema.Struct({
  chainId: Schema.Number,
  address: Schema.String,
  symbol: Schema.String,
  name: Schema.String,
  decimals: Schema.Number,
  logoUrl: Schema.NullOr(Schema.String),
  isVerified: Schema.Boolean,
  isNative: Schema.Boolean,
  totalSupply: Schema.NullOr(Schema.String),
  createdAt: Schema.Number,
  updatedAt: Schema.Number,
})

export type Token = Schema.Schema.Type<typeof TokenSchema>

export const TokenListResponseSchema = Schema.Struct({
  tokens: Schema.Array(TokenSchema),
  count: Schema.Number,
})

export type TokenListResponse = Schema.Schema.Type<typeof TokenListResponseSchema>

export const TokenResponseSchema = Schema.Struct({
  token: TokenSchema,
})

export type TokenResponse = Schema.Schema.Type<typeof TokenResponseSchema>
