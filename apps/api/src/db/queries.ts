/**
 * AetherDEX typed query helpers
 */

import { Effect } from "effect"
import { SqlClient } from "effect/unstable/sql"
import {
  type LiquidityEvent,
  type Pool,
  rowToLiquidityEvent,
  rowToPool,
  rowToToken,
  rowToTransaction,
  rowToUser,
  type Token,
  type Transaction,
} from "./schema"

/* ============ TOKENS ============ */

export const getTokenByAddress = (address: string, chainId = 1) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const rows = yield* sql`SELECT * FROM tokens WHERE chain_id = ${chainId} AND address = ${address}`
    if (rows.length === 0) return null
    return rowToToken(rows[0] as Record<string, unknown>)
  })

export const listVerifiedTokens = (limit = 100) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const rows = yield* sql`SELECT * FROM tokens WHERE is_verified = 1 ORDER BY symbol LIMIT ${limit}`
    return rows.map((r) => rowToToken(r as Record<string, unknown>))
  })

export const upsertToken = (token: Omit<Token, "createdAt" | "updatedAt">) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    yield* sql`
      INSERT INTO tokens (chain_id, address, symbol, name, decimals, logo_url, is_verified, is_native, total_supply, created_at, updated_at)
      VALUES (${token.chainId}, ${token.address}, ${token.symbol}, ${token.name}, ${token.decimals}, ${token.logoUrl}, ${token.isVerified ? 1 : 0}, ${token.isNative ? 1 : 0}, ${token.totalSupply}, ${Date.now()}, ${Date.now()})
      ON CONFLICT(chain_id, address) DO UPDATE SET
        symbol = excluded.symbol,
        name = excluded.name,
        decimals = excluded.decimals,
        logo_url = excluded.logo_url,
        is_verified = excluded.is_verified,
        total_supply = excluded.total_supply,
        updated_at = excluded.updated_at
    `
  })

/* ============ POOLS ============ */

export const getPoolById = (poolId: string, chainId = 1) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const rows = yield* sql`SELECT * FROM pools WHERE chain_id = ${chainId} AND pool_id = ${poolId}`
    if (rows.length === 0) return null
    return rowToPool(rows[0] as Record<string, unknown>)
  })

export const listActivePools = (limit = 50, chainId = 1) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const rows = yield* sql`
      SELECT * FROM pools
      WHERE chain_id = ${chainId} AND is_active = 1
      ORDER BY tvl_usd DESC
      LIMIT ${limit}
    `
    return rows.map((r) => rowToPool(r as Record<string, unknown>))
  })

export const upsertPool = (pool: Omit<Pool, "createdAt" | "updatedAt">) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    yield* sql`
      INSERT INTO pools (chain_id, pool_id, token0_address, token1_address, fee, tick_spacing, hook_address, sqrt_price_x96, current_tick, liquidity, tvl_usd, volume_24h_usd, fees_24h_usd, is_active, created_at, updated_at)
      VALUES (${pool.chainId}, ${pool.poolId}, ${pool.token0Address}, ${pool.token1Address}, ${pool.fee}, ${pool.tickSpacing}, ${pool.hookAddress}, ${pool.sqrtPriceX96}, ${pool.currentTick}, ${pool.liquidity}, ${pool.tvlUsd}, ${pool.volume24hUsd}, ${pool.fees24hUsd}, ${pool.isActive ? 1 : 0}, ${Date.now()}, ${Date.now()})
      ON CONFLICT(chain_id, pool_id) DO UPDATE SET
        sqrt_price_x96 = excluded.sqrt_price_x96,
        current_tick = excluded.current_tick,
        liquidity = excluded.liquidity,
        tvl_usd = excluded.tvl_usd,
        volume_24h_usd = excluded.volume_24h_usd,
        fees_24h_usd = excluded.fees_24h_usd,
        is_active = excluded.is_active,
        updated_at = excluded.updated_at
    `
  })

/* ============ TRANSACTIONS ============ */

export const getTransactionsByUser = (userAddress: string, limit = 50) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const rows =
      yield* sql`SELECT * FROM transactions WHERE user_address = ${userAddress} ORDER BY block_timestamp DESC LIMIT ${limit}`
    return rows.map((r) => rowToTransaction(r as Record<string, unknown>))
  })

export const insertTransaction = (tx: Omit<Transaction, "id" | "createdAt">) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    yield* sql`
      INSERT INTO transactions (chain_id, tx_hash, user_address, pool_id, tx_type, token_in, token_out, amount_in, amount_out, amount_usd, gas_used, gas_price, block_number, block_timestamp, status, created_at)
      VALUES (${tx.chainId}, ${tx.txHash}, ${tx.userAddress}, ${tx.poolId}, ${tx.txType}, ${tx.tokenIn}, ${tx.tokenOut}, ${tx.amountIn}, ${tx.amountOut}, ${tx.amountUsd}, ${tx.gasUsed}, ${tx.gasPrice}, ${tx.blockNumber}, ${tx.blockTimestamp}, ${tx.status}, ${Date.now()})
    `
  })

/* ============ USERS ============ */

export const upsertUser = (address: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const nonce = crypto.randomUUID()
    yield* sql`
      INSERT INTO users (address, nonce, first_seen_at, last_active_at, tx_count, total_volume_usd)
      VALUES (${address}, ${nonce}, ${Date.now()}, ${Date.now()}, 0, 0)
      ON CONFLICT(address) DO UPDATE SET last_active_at = excluded.last_active_at
    `
    return nonce
  })

export const getUser = (address: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const rows = yield* sql`SELECT * FROM users WHERE address = ${address}`
    if (rows.length === 0) return null
    return rowToUser(rows[0] as Record<string, unknown>)
  })

/* ============ SWAP RECORD ============ */

export interface RecordSwapInput {
  chainId?: number
  txHash: string
  userAddress: string
  poolId: string | null
  tokenIn: string | null
  tokenOut: string | null
  amountIn: string | null
  amountOut: string | null
  amountUsd: number | null
  blockNumber: number
  blockTimestamp: number
}

export const recordSwap = (tx: RecordSwapInput) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    yield* sql`
      INSERT INTO transactions
        (chain_id, tx_hash, user_address, pool_id, tx_type, token_in, token_out, amount_in, amount_out, amount_usd, block_number, block_timestamp, status, created_at)
      VALUES (${tx.chainId ?? 1}, ${tx.txHash}, ${tx.userAddress}, ${tx.poolId}, 'swap', ${tx.tokenIn}, ${tx.tokenOut}, ${tx.amountIn}, ${tx.amountOut}, ${tx.amountUsd}, ${tx.blockNumber}, ${tx.blockTimestamp}, 'pending', ${Date.now()})
      ON CONFLICT(chain_id, tx_hash) DO NOTHING
    `
  })

export const insertLiquidityEvent = (event: Omit<LiquidityEvent, "id" | "createdAt">) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    yield* sql`
      INSERT INTO liquidity_events
        (chain_id, protocol, event_type, tx_hash, log_index, block_number, block_timestamp, pool_id, token_id,
         owner_address, tick_lower, tick_upper, liquidity_delta, amount0, amount1, created_at)
      VALUES (${event.chainId}, ${event.protocol}, ${event.eventType}, ${event.txHash}, ${event.logIndex},
        ${event.blockNumber}, ${event.blockTimestamp}, ${event.poolId}, ${event.tokenId}, ${event.ownerAddress},
        ${event.tickLower}, ${event.tickUpper}, ${event.liquidityDelta}, ${event.amount0}, ${event.amount1}, ${Date.now()})
      ON CONFLICT(chain_id, tx_hash, log_index) DO NOTHING
    `
  })

export const listLiquidityEvents = (chainId: number, protocol: "v3" | "v4", tokenId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const rows = yield* sql`
      SELECT * FROM liquidity_events
      WHERE chain_id = ${chainId} AND protocol = ${protocol} AND token_id = ${tokenId}
      ORDER BY block_number ASC, log_index ASC
    `
    return rows.map((row) => rowToLiquidityEvent(row as Record<string, unknown>))
  })

export const updateLiquidityPosition = (input: {
  chainId: number
  tokenId: string
  ownerAddress: string
  liquidity: string
  amount0: string
  amount1: string
  fees0: string
  fees1: string
  costBasis0: string
  costBasis1: string
  isActive: boolean
}) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const rows = yield* sql`
      UPDATE liquidity_positions
      SET user_address = ${input.ownerAddress}, liquidity = ${input.liquidity}, amount0 = ${input.amount0},
          amount1 = ${input.amount1}, fees_earned_token0 = ${input.fees0}, fees_earned_token1 = ${input.fees1},
          cost_basis_token0 = ${input.costBasis0}, cost_basis_token1 = ${input.costBasis1},
          is_active = ${input.isActive ? 1 : 0}, updated_at = ${Date.now()}
      WHERE chain_id = ${input.chainId} AND protocol = 'v3' AND token_id = ${input.tokenId}
      RETURNING id
    `
    const id = rows[0]?.id
    return typeof id === "number" ? id : null
  })

export const updateV4LiquidityPosition = (input: {
  chainId: number
  tokenId: string
  ownerAddress: string
  tickLower: number
  tickUpper: number
  liquidity: string
}) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const rows = yield* sql`
      UPDATE liquidity_positions
      SET user_address = ${input.ownerAddress}, tick_lower = ${input.tickLower}, tick_upper = ${input.tickUpper},
          liquidity = ${input.liquidity}, is_active = 1, updated_at = ${Date.now()}
      WHERE chain_id = ${input.chainId} AND protocol = 'v4' AND token_id = ${input.tokenId}
      RETURNING id
    `
    const id = rows[0]?.id
    return typeof id === "number" ? id : null
  })
