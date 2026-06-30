/**
 * AetherDEX D1 schema — TypeScript types
 * Matches migrations/0001_initial_schema.sql
 */

export interface User {
  address: string
  nonce: string
  firstSeenAt: number
  lastActiveAt: number
  txCount: number
  totalVolumeUsd: number
}

export interface Token {
  address: string
  symbol: string
  name: string
  decimals: number
  logoUrl: string | null
  isVerified: boolean
  isNative: boolean
  totalSupply: string | null
  createdAt: number
  updatedAt: number
}

export interface Pool {
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

export type TransactionType = "swap" | "add_liquidity" | "remove_liquidity" | "create_pool"
export type TransactionStatus = "pending" | "confirmed" | "failed"

export interface Transaction {
  id: number
  txHash: string
  userAddress: string
  poolId: string | null
  txType: TransactionType
  tokenIn: string | null
  tokenOut: string | null
  amountIn: string | null
  amountOut: string | null
  amountUsd: number | null
  gasUsed: number | null
  gasPrice: string | null
  blockNumber: number
  blockTimestamp: number
  status: TransactionStatus
  createdAt: number
}

export interface LiquidityPosition {
  id: number
  userAddress: string
  poolId: string
  tickLower: number
  tickUpper: number
  liquidity: string
  amount0: string
  amount1: string
  feesEarnedToken0: string
  feesEarnedToken1: string
  isActive: boolean
  createdAt: number
  updatedAt: number
}

export interface PriceCache {
  tokenAddress: string
  priceUsd: number
  updatedAt: number
}

/**
 * Convert SQL row (snake_case) to TS interface (camelCase)
 */
export function rowToToken(row: Record<string, unknown>): Token {
  return {
    address: row.address as string,
    symbol: row.symbol as string,
    name: row.name as string,
    decimals: row.decimals as number,
    logoUrl: (row.logo_url as string | null) ?? null,
    isVerified: Boolean(row.is_verified),
    isNative: Boolean(row.is_native),
    totalSupply: (row.total_supply as string | null) ?? null,
    createdAt: row.created_at as number,
    updatedAt: row.updated_at as number,
  }
}

export function rowToPool(row: Record<string, unknown>): Pool {
  return {
    poolId: row.pool_id as string,
    token0Address: row.token0_address as string,
    token1Address: row.token1_address as string,
    fee: row.fee as number,
    tickSpacing: row.tick_spacing as number,
    hookAddress: (row.hook_address as string | null) ?? null,
    sqrtPriceX96: row.sqrt_price_x96 as string,
    currentTick: row.current_tick as number,
    liquidity: row.liquidity as string,
    tvlUsd: row.tvl_usd as number,
    volume24hUsd: row.volume_24h_usd as number,
    fees24hUsd: row.fees_24h_usd as number,
    isActive: Boolean(row.is_active),
    createdAt: row.created_at as number,
    updatedAt: row.updated_at as number,
  }
}

export function rowToTransaction(row: Record<string, unknown>): Transaction {
  return {
    id: row.id as number,
    txHash: row.tx_hash as string,
    userAddress: row.user_address as string,
    poolId: (row.pool_id as string | null) ?? null,
    txType: row.tx_type as TransactionType,
    tokenIn: (row.token_in as string | null) ?? null,
    tokenOut: (row.token_out as string | null) ?? null,
    amountIn: (row.amount_in as string | null) ?? null,
    amountOut: (row.amount_out as string | null) ?? null,
    amountUsd: (row.amount_usd as number | null) ?? null,
    gasUsed: (row.gas_used as number | null) ?? null,
    gasPrice: (row.gas_price as string | null) ?? null,
    blockNumber: row.block_number as number,
    blockTimestamp: row.block_timestamp as number,
    status: row.status as TransactionStatus,
    createdAt: row.created_at as number,
  }
}

export function rowToUser(row: Record<string, unknown>): User {
  return {
    address: row.address as string,
    nonce: row.nonce as string,
    firstSeenAt: row.first_seen_at as number,
    lastActiveAt: row.last_active_at as number,
    txCount: row.tx_count as number,
    totalVolumeUsd: row.total_volume_usd as number,
  }
}

export function rowToLiquidityPosition(row: Record<string, unknown>): LiquidityPosition {
  return {
    id: row.id as number,
    userAddress: row.user_address as string,
    poolId: row.pool_id as string,
    tickLower: row.tick_lower as number,
    tickUpper: row.tick_upper as number,
    liquidity: row.liquidity as string,
    amount0: row.amount0 as string,
    amount1: row.amount1 as string,
    feesEarnedToken0: row.fees_earned_token0 as string,
    feesEarnedToken1: row.fees_earned_token1 as string,
    isActive: Boolean(row.is_active),
    createdAt: row.created_at as number,
    updatedAt: row.updated_at as number,
  }
}

export function rowToPriceCache(row: Record<string, unknown>): PriceCache {
  return {
    tokenAddress: row.token_address as string,
    priceUsd: row.price_usd as number,
    updatedAt: row.updated_at as number,
  }
}
