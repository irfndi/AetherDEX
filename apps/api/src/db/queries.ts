/**
 * AetherDEX typed query helpers
 */

import { SqlClient } from "@effect/sql"
import { Effect } from "effect"
import { type Pool, rowToPool, rowToToken, rowToTransaction, rowToUser, type Token, type Transaction } from "./schema"

/* ============ TOKENS ============ */

export const getTokenByAddress = (address: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const rows = yield* sql`SELECT * FROM tokens WHERE address = ${address}`
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
      INSERT INTO tokens (address, symbol, name, decimals, logo_url, is_verified, is_native, total_supply, created_at, updated_at)
      VALUES (${token.address}, ${token.symbol}, ${token.name}, ${token.decimals}, ${token.logoUrl}, ${token.isVerified ? 1 : 0}, ${token.isNative ? 1 : 0}, ${token.totalSupply}, ${Date.now()}, ${Date.now()})
      ON CONFLICT(address) DO UPDATE SET
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

export const getPoolById = (poolId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const rows = yield* sql`SELECT * FROM pools WHERE pool_id = ${poolId}`
    if (rows.length === 0) return null
    return rowToPool(rows[0] as Record<string, unknown>)
  })

export const listActivePools = (limit = 50) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const rows = yield* sql`SELECT * FROM pools WHERE is_active = 1 ORDER BY tvl_usd DESC LIMIT ${limit}`
    return rows.map((r) => rowToPool(r as Record<string, unknown>))
  })

export const upsertPool = (pool: Omit<Pool, "createdAt" | "updatedAt">) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    yield* sql`
      INSERT INTO pools (pool_id, token0_address, token1_address, fee, tick_spacing, hook_address, sqrt_price_x96, current_tick, liquidity, tvl_usd, volume_24h_usd, fees_24h_usd, is_active, created_at, updated_at)
      VALUES (${pool.poolId}, ${pool.token0Address}, ${pool.token1Address}, ${pool.fee}, ${pool.tickSpacing}, ${pool.hookAddress}, ${pool.sqrtPriceX96}, ${pool.currentTick}, ${pool.liquidity}, ${pool.tvlUsd}, ${pool.volume24hUsd}, ${pool.fees24hUsd}, ${pool.isActive ? 1 : 0}, ${Date.now()}, ${Date.now()})
      ON CONFLICT(pool_id) DO UPDATE SET
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
      INSERT INTO transactions (tx_hash, user_address, pool_id, tx_type, token_in, token_out, amount_in, amount_out, amount_usd, gas_used, gas_price, block_number, block_timestamp, status, created_at)
      VALUES (${tx.txHash}, ${tx.userAddress}, ${tx.poolId}, ${tx.txType}, ${tx.tokenIn}, ${tx.tokenOut}, ${tx.amountIn}, ${tx.amountOut}, ${tx.amountUsd}, ${tx.gasUsed}, ${tx.gasPrice}, ${tx.blockNumber}, ${tx.blockTimestamp}, ${tx.status}, ${Date.now()})
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
