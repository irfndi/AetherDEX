import { env } from "cloudflare:test"
import { beforeAll, describe, expect, it } from "vitest"
import m0001 from "../migrations/0001_initial_schema.sql?raw"
import m0002 from "../migrations/0002_seed_data.sql?raw"
import m0003 from "../migrations/0003_chain_scoped_tokens.sql?raw"
import m0004 from "../migrations/0004_phase1_chain_and_events.sql?raw"
import m0005 from "../migrations/0005_chain_qualified_pool_keys.sql?raw"
import m0006 from "../migrations/0006_chain_qualified_price_cache.sql?raw"
import m0007 from "../migrations/0007_v3_indexer_cursor.sql?raw"
import { pools } from "../src/routes/pools"

const MIGRATIONS = [m0001, m0002, m0003, m0004, m0005, m0006, m0007]

const splitStatements = (script: string): string[] =>
  script
    .split("\n")
    .map((line) => line.split("--")[0])
    .join("\n")
    .split(";")
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0 && !statement.startsWith("PRAGMA foreign_key_check"))

beforeAll(async () => {
  for (const script of MIGRATIONS) {
    for (const statement of splitStatements(script)) {
      await env.DB.prepare(statement).run()
    }
  }
  await env.DB.prepare("PRAGMA foreign_keys = OFF").run()
})

// 64 lowercase hex chars ("ab" x 32) — deliberately letter-heavy so casing matters.
const POOL_ID = `0x${"ab".repeat(32)}`
const UNKNOWN_POOL_ID = `0x${"cd".repeat(32)}`

const testEnv = { ...env, CHAIN_ID: "11155111" } as unknown as Env

async function seedPool(poolId: string): Promise<void> {
  await env.DB.prepare(
    `INSERT OR IGNORE INTO pools
       (chain_id, pool_id, token0_address, token1_address, fee, tick_spacing, hook_address, sqrt_price_x96, current_tick, liquidity, tvl_usd, volume_24h_usd, fees_24h_usd, is_active, created_at, updated_at)
     VALUES (?, ?, ?, ?, 3000, 60, NULL, '0', 0, '0', 1000, 500, 100, 1, 0, 0)`,
  )
    .bind(11155111, poolId, "0xA000000000000000000000000000000000000001", "0xB000000000000000000000000000000000000002")
    .run()
}

describe("GET /api/v1/pools", () => {
  it("rejects unknown sortBy / sortDirection values with 400 instead of casting to enums", async () => {
    for (const query of ["sortBy=invalid", "sortDirection=up", "sortBy=invalid&sortDirection=up"]) {
      const response = await pools.request(`/?${query}`, undefined, testEnv)
      expect(response.status).toBe(400)
      expect(await response.json()).toEqual({
        error: "sortBy must be one of: tvl, volume, fees, created; sortDirection must be asc or desc",
      })
    }
  })

  it("accepts valid sortBy / sortDirection values", async () => {
    const response = await pools.request("/?sortBy=volume&sortDirection=asc", undefined, testEnv)
    expect(response.status).toBe(200)
  })
})

describe("GET /api/v1/pools/:poolId", () => {
  it("rejects a malformed poolId before touching storage", async () => {
    const response = await pools.request("/0x123", undefined, testEnv)
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: "Invalid poolId (must be 0x + 64 hex chars)" })
  })

  it("returns 404 for a syntactically valid but unknown poolId", async () => {
    const response = await pools.request(`/${UNKNOWN_POOL_ID}`, undefined, testEnv)
    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ error: "Pool not found" })
  })

  it("resolves a mixed-case poolId to the stored lowercase pool", async () => {
    await seedPool(POOL_ID)
    const response = await pools.request(`/0x${"ab".repeat(32).toUpperCase()}`, undefined, testEnv)
    expect(response.status).toBe(200)
    const body = (await response.json()) as { pool: { poolId: string } }
    expect(body.pool.poolId).toBe(POOL_ID)
  })

  it("returns the seeded pool for its exact lowercase id", async () => {
    await seedPool(POOL_ID)
    const response = await pools.request(`/${POOL_ID}`, undefined, testEnv)
    expect(response.status).toBe(200)
    const body = (await response.json()) as { pool: { poolId: string; tvlUsd: number } }
    expect(body.pool.poolId).toBe(POOL_ID)
    expect(body.pool.tvlUsd).toBe(1000)
  })

  it("returns a generic 500 without leaking D1 internals when the DB layer fails", async () => {
    await env.DB.prepare("DROP TABLE pools").run()
    const response = await pools.request(`/${POOL_ID}`, undefined, testEnv)
    expect(response.status).toBe(500)
    const body = (await response.json()) as { error: string }
    expect(body.error).toBe("Internal error")
    expect(body.error).not.toContain("no such table")
    expect(JSON.stringify(body)).not.toContain("PoolReadError")
  })
})
