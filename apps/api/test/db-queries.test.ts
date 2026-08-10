/**
 * db/queries.ts — D1-backed query helper behaviours.
 *
 * Worker-pool integration tests against the test D1 database: upsert nonce
 * persistence, monotonic indexer cursors, transaction conflict handling, and
 * the liquidity-position update result (no silent null on a missing row).
 */

import { env } from "cloudflare:test"
import { Effect } from "effect"
import { beforeAll, describe, expect, it } from "vitest"
import m0001 from "../migrations/0001_initial_schema.sql?raw"
import m0002 from "../migrations/0002_seed_data.sql?raw"
import m0003 from "../migrations/0003_chain_scoped_tokens.sql?raw"
import m0004 from "../migrations/0004_phase1_chain_and_events.sql?raw"
import m0005 from "../migrations/0005_chain_qualified_pool_keys.sql?raw"
import m0006 from "../migrations/0006_chain_qualified_price_cache.sql?raw"
import m0007 from "../migrations/0007_v3_indexer_cursor.sql?raw"
import { makeDbLayer } from "../src/db/client"
import {
  getIndexerCursor,
  getUser,
  insertTransaction,
  setIndexerCursor,
  updateLiquidityPosition,
  updateV4LiquidityPosition,
  upsertToken,
  upsertUser,
} from "../src/db/queries"
import { rowToLiquidityPosition, rowToToken } from "../src/db/schema"

const MIGRATIONS = [m0001, m0002, m0003, m0004, m0005, m0006, m0007]

const splitStatements = (script: string): string[] =>
  script
    .split("\n")
    .map((line) => line.split("--")[0])
    .join("\n")
    .split(";")
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0 && !statement.startsWith("PRAGMA foreign_key_check"))

const applyMigrations = async (db: D1Database): Promise<void> => {
  for (const script of MIGRATIONS) {
    for (const statement of splitStatements(script)) {
      await db.prepare(statement).run()
    }
  }
  // The indexer relies on the platform default (off): pool currencies are not
  // seeded into tokens, so cross-table FKs would reject valid writes.
  await db.prepare("PRAGMA foreign_keys = OFF").run()
}

const run = <A, E>(effect: Effect.Effect<A, E, never>): Promise<A> =>
  Effect.runPromise(effect.pipe(Effect.provide(makeDbLayer(env.DB))))

const raw = (sql: string, ...bind: unknown[]) => env.DB.prepare(sql).bind(...bind)

beforeAll(async () => {
  await applyMigrations(env.DB)
})

describe("db queries", () => {
  it("persists the nonce returned by upsertUser for existing users", async () => {
    const address = "0x1111111111111111111111111111111111111111"
    await run(upsertUser(address))

    const firstNonce = await run(upsertUser(address))
    // A fresh nonce is generated per call and MUST be stored — otherwise a
    // SIWE sign-in verifying the returned nonce fails for every returning user.
    expect(firstNonce).toMatch(/^[0-9a-f-]{36}$/)

    const stored = await run(getUser(address))
    expect(stored?.nonce).toBe(firstNonce)
  })

  it("never regresses the indexer cursor on out-of-order writes", async () => {
    const chainId = 700
    const indexer = "test_indexer"

    await run(setIndexerCursor(chainId, indexer, 100n))
    // A stale worker committing a smaller next_block must not move the cursor back.
    await run(setIndexerCursor(chainId, indexer, 50n))

    expect(await run(getIndexerCursor(chainId, indexer))).toBe(100n)
  })

  it("insertTransaction is a no-op on a duplicate (chain_id, tx_hash)", async () => {
    const user = "0x2222222222222222222222222222222222222222"
    await run(upsertUser(user))
    const tx = {
      chainId: 1,
      txHash: "0xdup",
      userAddress: user,
      poolId: null,
      txType: "swap" as const,
      tokenIn: null,
      tokenOut: null,
      amountIn: null,
      amountOut: null,
      amountUsd: null,
      gasUsed: null,
      gasPrice: null,
      blockNumber: 10,
      blockTimestamp: 1000,
      status: "pending" as const,
    }

    await run(insertTransaction(tx))
    // Second insert of the same key must succeed as a no-op, not raise a
    // unique-constraint violation (recordSwap already uses DO NOTHING here).
    await expect(run(insertTransaction(tx))).resolves.toBeUndefined()

    const count = await raw(
      "SELECT COUNT(*) AS c FROM transactions WHERE chain_id = ? AND tx_hash = ?",
      1,
      "0xdup",
    ).first<{ c: number }>()
    expect(count?.c).toBe(1)
  })

  it("updateLiquidityPosition reports a miss explicitly instead of a silent null", async () => {
    const miss = await run(
      updateLiquidityPosition({
        chainId: 1,
        tokenId: "no-such-token",
        ownerAddress: "0x3333333333333333333333333333333333333333",
        liquidity: "1",
        amount0: "1",
        amount1: "1",
        fees0: "0",
        fees1: "0",
        costBasis0: "0",
        costBasis1: "0",
        isActive: true,
      }),
    )
    expect(miss).toEqual({ updated: false })
  })

  it("updateLiquidityPosition and updateV4LiquidityPosition return the id on a hit", async () => {
    const owner = "0x3333333333333333333333333333333333333333"
    await run(upsertUser(owner))
    await raw(
      `INSERT INTO pools
        (chain_id, pool_id, token0_address, token1_address, fee, tick_spacing, sqrt_price_x96, current_tick,
         liquidity, tvl_usd, volume_24h_usd, fees_24h_usd, is_active, created_at, updated_at)
       VALUES (1, 'pool-1', '0x0000000000000000000000000000000000000001', '0x0000000000000000000000000000000000000002',
         3000, 60, '0', 0, '0', 0, 0, 0, 1, 0, 0)`,
    ).run()
    await raw(
      `INSERT INTO liquidity_positions
        (chain_id, protocol, token_id, user_address, pool_id, tick_lower, tick_upper, liquidity,
         amount0, amount1, fees_earned_token0, fees_earned_token1, is_active, created_at, updated_at)
       VALUES (1, 'v3', 'v3-token', ?, 'pool-1', -60, 60,
         '100', '1', '2', '0', '0', 1, 0, 0)`,
      owner,
    ).run()

    const v3 = await run(
      updateLiquidityPosition({
        chainId: 1,
        tokenId: "v3-token",
        ownerAddress: owner,
        liquidity: "200",
        amount0: "3",
        amount1: "4",
        fees0: "0",
        fees1: "0",
        costBasis0: "0",
        costBasis1: "0",
        isActive: true,
      }),
    )
    expect(v3).toEqual({ updated: true, id: expect.any(Number) })

    await raw(
      `INSERT INTO liquidity_positions
        (chain_id, protocol, token_id, user_address, pool_id, tick_lower, tick_upper, liquidity,
         amount0, amount1, is_active, created_at, updated_at)
       VALUES (1, 'v4', 'v4-token', ?, 'pool-1', -120, 120,
         '50', '1', '1', 1, 0, 0)`,
      owner,
    ).run()

    const v4 = await run(
      updateV4LiquidityPosition({
        chainId: 1,
        tokenId: "v4-token",
        ownerAddress: owner,
        tickLower: -120,
        tickUpper: 120,
        liquidity: "99",
      }),
    )
    expect(v4).toEqual({ updated: true, id: expect.any(Number) })
  })

  it("row converters map 0/1 flags and unknown protocols deterministically", async () => {
    await run(
      upsertToken({
        chainId: 1,
        address: "0x4444444444444444444444444444444444444444",
        symbol: "T",
        name: "Token",
        decimals: 18,
        logoUrl: null,
        isVerified: false,
        isNative: true,
        totalSupply: "1000",
      }),
    )

    const token = rowToToken({
      chain_id: 1,
      address: "0x4444444444444444444444444444444444444444",
      symbol: "T",
      name: "Token",
      decimals: 18,
      logo_url: null,
      is_verified: 0,
      is_native: 1,
      total_supply: "1000",
      created_at: 1,
      updated_at: 2,
    })
    expect(token.isVerified).toBe(false)
    expect(token.isNative).toBe(true)

    const position = rowToLiquidityPosition({
      protocol: "v9",
      user_address: "0x5555555555555555555555555555555555555555",
      pool_id: "pool-1",
      tick_lower: 0,
      tick_upper: 10,
      liquidity: "1",
      amount0: "1",
      amount1: "1",
      fees_earned_token0: "0",
      fees_earned_token1: "0",
      is_active: 0,
      created_at: 1,
      updated_at: 2,
    } as unknown as Record<string, unknown>)
    // Unknown protocol string falls back to v4 (v3 is matched exactly).
    expect(position.protocol).toBe("v4")
  })
})
