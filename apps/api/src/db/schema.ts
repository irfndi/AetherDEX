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
  chainId: number
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
  chainId: number
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
  chainId: number
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
  chainId: number
  protocol: "v3" | "v4"
  tokenId: string | null
  userAddress: string
  poolId: string
  tickSpacing: number
  tickLower: number
  tickUpper: number
  liquidity: string
  amount0: string
  amount1: string
  feesEarnedToken0: string
  feesEarnedToken1: string
  costBasisToken0: string
  costBasisToken1: string
  isActive: boolean
  createdAt: number
  updatedAt: number
  readonly poolToken0Address?: string
  readonly poolToken1Address?: string
  readonly poolToken0Decimals?: number
  readonly poolToken1Decimals?: number
  readonly poolFee?: number
  readonly poolHookAddress?: string | null
  readonly poolSqrtPriceX96?: string
  readonly poolCurrentTick?: number
  readonly poolLiquidity?: string
}

export type LiquidityEventType = "mint" | "burn" | "increase" | "decrease" | "collect" | "transfer"

export interface LiquidityEvent {
  id: number
  chainId: number
  protocol: "v3" | "v4"
  eventType: LiquidityEventType
  txHash: string
  logIndex: number
  blockNumber: number
  blockTimestamp: number
  poolId: string | null
  tokenId: string | null
  ownerAddress: string | null
  tickLower: number | null
  tickUpper: number | null
  liquidityDelta: string | null
  amount0: string | null
  amount1: string | null
  createdAt: number
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
    chainId: (row.chain_id as number | undefined) ?? 1,
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
    chainId: (row.chain_id as number | undefined) ?? 1,
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
    chainId: (row.chain_id as number | undefined) ?? 1,
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
    chainId: (row.chain_id as number | undefined) ?? 1,
    protocol: row.protocol === "v3" ? "v3" : "v4",
    tokenId: (row.token_id as string | null) ?? null,
    userAddress: row.user_address as string,
    poolId: row.pool_id as string,
    tickSpacing: (row.tick_spacing as number | undefined) ?? 0,
    tickLower: row.tick_lower as number,
    tickUpper: row.tick_upper as number,
    liquidity: row.liquidity as string,
    amount0: row.amount0 as string,
    amount1: row.amount1 as string,
    feesEarnedToken0: row.fees_earned_token0 as string,
    feesEarnedToken1: row.fees_earned_token1 as string,
    costBasisToken0: (row.cost_basis_token0 as string | undefined) ?? "0",
    costBasisToken1: (row.cost_basis_token1 as string | undefined) ?? "0",
    isActive: Boolean(row.is_active),
    createdAt: row.created_at as number,
    updatedAt: row.updated_at as number,
    poolToken0Address: (row.pool_token0_address as string | undefined) ?? undefined,
    poolToken1Address: (row.pool_token1_address as string | undefined) ?? undefined,
    poolToken0Decimals: (row.pool_token0_decimals as number | undefined) ?? undefined,
    poolToken1Decimals: (row.pool_token1_decimals as number | undefined) ?? undefined,
    poolFee: (row.pool_fee as number | undefined) ?? undefined,
    poolHookAddress: (row.pool_hook_address as string | null | undefined) ?? null,
    poolSqrtPriceX96: (row.pool_sqrt_price_x96 as string | undefined) ?? undefined,
    poolCurrentTick: (row.pool_current_tick as number | undefined) ?? undefined,
    poolLiquidity: (row.pool_liquidity as string | undefined) ?? undefined,
  }
}

export function rowToLiquidityEvent(row: Record<string, unknown>): LiquidityEvent {
  return {
    id: row.id as number,
    chainId: (row.chain_id as number | undefined) ?? 1,
    protocol: row.protocol === "v3" ? "v3" : "v4",
    eventType: row.event_type as LiquidityEventType,
    txHash: row.tx_hash as string,
    logIndex: row.log_index as number,
    blockNumber: row.block_number as number,
    blockTimestamp: row.block_timestamp as number,
    poolId: (row.pool_id as string | null) ?? null,
    tokenId: (row.token_id as string | null) ?? null,
    ownerAddress: (row.owner_address as string | null) ?? null,
    tickLower: (row.tick_lower as number | null) ?? null,
    tickUpper: (row.tick_upper as number | null) ?? null,
    liquidityDelta: (row.liquidity_delta as string | null) ?? null,
    amount0: (row.amount0 as string | null) ?? null,
    amount1: (row.amount1 as string | null) ?? null,
    createdAt: row.created_at as number,
  }
}

export function rowToPriceCache(row: Record<string, unknown>): PriceCache {
  return {
    tokenAddress: row.token_address as string,
    priceUsd: row.price_usd as number,
    updatedAt: row.updated_at as number,
  }
}
