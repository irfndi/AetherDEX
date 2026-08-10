/**
 * Worker cron handlers — keeper tick, pool refresh, and price enqueue.
 *
 * Covers:
 * - keeper tick: enqueues pending orders and auto-recenter checks, expires
 *   overdue orders (clawpatch 3ad6)
 * - invalid CHAIN_ID bails before any query/enqueue instead of silently
 *   falling back to a guessed chain (clawpatch a4ef)
 * - a corrupt price KV payload does not abort the whole pool refresh (81f9)
 * - pools with pending orders / active policies get poolSpot even outside the
 *   top-50 by TVL (8725)
 * - poolSpot payload carries the pool's current on-chain tick (b288)
 */

import { env } from "cloudflare:test"
import { beforeAll, describe, expect, it, type Mock, vi } from "vitest"
import m0001 from "../../migrations/0001_initial_schema.sql?raw"
import m0002 from "../../migrations/0002_seed_data.sql?raw"
import m0003 from "../../migrations/0003_chain_scoped_tokens.sql?raw"
import m0004 from "../../migrations/0004_phase1_chain_and_events.sql?raw"
import m0005PoolKeys from "../../migrations/0005_chain_qualified_pool_keys.sql?raw"
import m0005TpSl from "../../migrations/0005_tp_sl_orders.sql?raw"
import m0006 from "../../migrations/0006_chain_qualified_price_cache.sql?raw"
import m0007 from "../../migrations/0007_v3_indexer_cursor.sql?raw"
import m0008 from "../../migrations/0008_tp_sl_onchain_order_id.sql?raw"
import { type CronEnv, enqueuePriceRefresh, refreshTopPools, runKeeperTick } from "../../src/workers/cron-handler"

const MIGRATIONS = [m0001, m0002, m0003, m0004, m0005PoolKeys, m0005TpSl, m0006, m0007, m0008]

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
})

const CHAIN_ID = 11155111
const USER_ADDRESS = "0x3333333333333333333333333333333333333333"
const TOKEN0 = "0x0000000000000000000000000000000000000701"
const TOKEN1 = "0x0000000000000000000000000000000000000702"
const BAD_TOKEN = "0x0000000000000000000000000000000000000703"

const poolIdFor = (index: number): string => `0x${String(index).padStart(64, "0")}`

const ensureUser = async (): Promise<void> => {
  await env.DB.prepare(
    "INSERT OR IGNORE INTO users (address, nonce, first_seen_at, last_active_at) VALUES (?, '0', 0, 0)",
  )
    .bind(USER_ADDRESS)
    .run()
}

interface FakeQueue {
  send: Mock
}

const makeQueue = (): FakeQueue => ({ send: vi.fn() })

const makeCronEnv = (overrides: Partial<CronEnv> = {}): CronEnv & { queues: Record<string, FakeQueue> } => {
  const keeperQueue = makeQueue()
  const priceQueue = makeQueue()
  const settleQueue = makeQueue()
  const cronEnv = {
    DB: env.DB,
    CACHE: env.CACHE,
    STORAGE: env.STORAGE,
    PRICE_QUEUE: priceQueue as unknown as CronEnv["PRICE_QUEUE"],
    SETTLE_QUEUE: settleQueue as unknown as CronEnv["SETTLE_QUEUE"],
    KEEPER_QUEUE: keeperQueue as unknown as CronEnv["KEEPER_QUEUE"],
    CHAIN_ID: String(CHAIN_ID),
    ...overrides,
  }
  return { ...cronEnv, queues: { keeperQueue, priceQueue, settleQueue } }
}

const seedPool = async (
  poolId: string,
  overrides: { tvlUsd?: number; currentTick?: number; isActive?: number } = {},
): Promise<void> => {
  await env.DB.prepare(
    `INSERT OR IGNORE INTO pools
       (chain_id, pool_id, token0_address, token1_address, fee, tick_spacing, hook_address, sqrt_price_x96, current_tick, liquidity, tvl_usd, volume_24h_usd, fees_24h_usd, is_active, created_at, updated_at)
     VALUES (?, ?, ?, ?, 3000, 60, NULL, '0', ?, '0', ?, 0, 0, ?, 0, 0)`,
  )
    .bind(CHAIN_ID, poolId, TOKEN0, TOKEN1, overrides.currentTick ?? 0, overrides.tvlUsd ?? 0, overrides.isActive ?? 1)
    .run()
}

const seedPrice = async (token: string, priceUsd: number): Promise<void> => {
  await env.CACHE.put(`price:${CHAIN_ID}:${token}`, JSON.stringify({ tokenAddress: token, priceUsd, updatedAt: 1 }), {
    expirationTtl: 300,
  })
}

const seedOrder = async (
  orderId: number,
  poolId: string,
  overrides: { deadline?: number; status?: string; onchainOrderId?: string } = {},
): Promise<void> => {
  await env.DB.prepare(
    `INSERT INTO tp_sl_orders
       (id, user_address, pool_id, order_type, zero_for_one, amount_in, min_amount_out,
        trigger_price_x18, twap_window, slippage_bps, deadline, status, created_at, chain_id, onchain_order_id)
     VALUES (?, ?, ?, 'take_profit', 0, '1000000', '1', '1000000000000000000', 300, 500, ?, ?, ?, ?, ?)`,
  )
    .bind(
      orderId,
      USER_ADDRESS,
      poolId,
      overrides.deadline ?? Date.now() + 600_000,
      overrides.status ?? "pending",
      Date.now(),
      CHAIN_ID,
      overrides.onchainOrderId ?? String(orderId - 1),
    )
    .run()
}

const readPoolSpot = async (poolId: string): Promise<{ price: string; tick?: number } | null> => {
  const raw = await env.CACHE.get(`poolSpot:${poolId}`)
  return raw ? (JSON.parse(raw) as { price: string; tick?: number }) : null
}

describe("runKeeperTick", () => {
  it("enqueues pending orders and expires overdue ones", async () => {
    const poolId = poolIdFor(1)
    await seedPool(poolId)
    await seedOrder(1, poolId, { onchainOrderId: "0" })
    await seedOrder(2, poolId, { deadline: Date.now() - 60_000, onchainOrderId: "1" })

    const cronEnv = makeCronEnv()
    await runKeeperTick(cronEnv as CronEnv)

    expect(cronEnv.queues.keeperQueue.send).toHaveBeenCalledWith(
      expect.objectContaining({ type: "tp-sl-evaluate", orderId: 1 }),
    )
    expect(cronEnv.queues.keeperQueue.send).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "tp-sl-evaluate", orderId: 2 }),
    )

    const expired = await env.DB.prepare("SELECT status FROM tp_sl_orders WHERE id = 2 AND chain_id = ?")
      .bind(CHAIN_ID)
      .first<{ status: string }>()
    expect(expired?.status).toBe("expired")
  })

  it("enqueues auto-recenter checks for active policies", async () => {
    const poolId = poolIdFor(2)
    await ensureUser()
    await seedPool(poolId)
    await env.DB.prepare(
      `INSERT INTO liquidity_positions
         (id, chain_id, user_address, pool_id, tick_lower, tick_upper, liquidity, amount0, amount1, is_active, created_at, updated_at)
       VALUES (1, ?, ?, ?, -100, 100, '1000', '0', '0', 1, 0, 0)`,
    )
      .bind(CHAIN_ID, USER_ADDRESS, poolId)
      .run()
    await env.DB.prepare(
      `INSERT INTO position_policies
         (id, user_address, position_id, pool_id, policy_type, is_active, min_drift_bps, cooldown_seconds, created_at, chain_id)
       VALUES (1, ?, '1', ?, 'auto_recenter', 1, 500, 3600, 0, ?)`,
    )
      .bind(USER_ADDRESS, poolId, CHAIN_ID)
      .run()

    const cronEnv = makeCronEnv()
    await runKeeperTick(cronEnv as CronEnv)

    expect(cronEnv.queues.keeperQueue.send).toHaveBeenCalledWith(
      expect.objectContaining({ type: "auto-recenter-check", policyId: 1, chainId: CHAIN_ID }),
    )
  })

  it("skips entirely when CHAIN_ID is invalid (no silent chain fallback)", async () => {
    const cronEnv = makeCronEnv({ CHAIN_ID: "not-a-chain" })
    await expect(runKeeperTick(cronEnv as CronEnv)).resolves.toBeUndefined()
    expect(cronEnv.queues.keeperQueue.send).not.toHaveBeenCalled()
  })
})

describe("refreshTopPools", () => {
  it("writes poolSpot (with tick) for pools whose tokens have prices", async () => {
    const poolId = poolIdFor(10)
    await seedPool(poolId, { tvlUsd: 100, currentTick: 42 })
    await seedPrice(TOKEN0, 2)
    await seedPrice(TOKEN1, 1)

    const cronEnv = makeCronEnv()
    await refreshTopPools(cronEnv as CronEnv)

    const poolSpot = await readPoolSpot(poolId)
    expect(poolSpot).not.toBeNull()
    // price = 2/1 scaled to x18
    expect(poolSpot?.price).toBe(String(2n * 10n ** 18n))
    // b288: the auto-recenter handler requires the pool's current tick
    expect(poolSpot?.tick).toBe(42)
  })

  it("survives a corrupt price KV payload and still refreshes the other pools", async () => {
    const goodPool = poolIdFor(20)
    const badPool = poolIdFor(21)
    await seedPool(goodPool, { tvlUsd: 100 })
    await env.DB.prepare(
      `INSERT OR IGNORE INTO pools
         (chain_id, pool_id, token0_address, token1_address, fee, tick_spacing, hook_address, sqrt_price_x96, current_tick, liquidity, tvl_usd, volume_24h_usd, fees_24h_usd, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, 3000, 60, NULL, '0', 0, '0', 90, 0, 0, 1, 0, 0)`,
    )
      .bind(CHAIN_ID, badPool, BAD_TOKEN, TOKEN1)
      .run()
    await seedPrice(TOKEN0, 2)
    await seedPrice(TOKEN1, 1)
    await env.CACHE.put(`price:${CHAIN_ID}:${BAD_TOKEN}`, "{ this is not json", { expirationTtl: 300 })

    const cronEnv = makeCronEnv()
    await refreshTopPools(cronEnv as CronEnv)

    expect(await readPoolSpot(goodPool)).not.toBeNull()
    expect(await readPoolSpot(badPool)).toBeNull()
  })

  it("writes poolSpot for a pool with a pending order even outside the top-50 by TVL", async () => {
    // 50 high-TVL pools ahead of the pending-order pool
    for (let i = 0; i < 50; i++) {
      await seedPool(poolIdFor(100 + i), { tvlUsd: 10_000, currentTick: i })
    }
    const pendingPool = poolIdFor(200)
    await seedPool(pendingPool, { tvlUsd: 1 })
    await seedOrder(900, pendingPool)
    await seedPrice(TOKEN0, 2)
    await seedPrice(TOKEN1, 1)

    const cronEnv = makeCronEnv()
    await refreshTopPools(cronEnv as CronEnv)

    expect(await readPoolSpot(pendingPool)).not.toBeNull()
  })

  it("skips entirely when CHAIN_ID is invalid", async () => {
    const cronEnv = makeCronEnv({ CHAIN_ID: "not-a-chain" })
    await expect(refreshTopPools(cronEnv as CronEnv)).resolves.toBeUndefined()
    expect(cronEnv.queues.priceQueue.send).not.toHaveBeenCalled()
  })
})

describe("enqueuePriceRefresh", () => {
  it("enqueues verified tokens for the configured chain", async () => {
    await env.DB.prepare(
      "INSERT INTO tokens (chain_id, address, symbol, name, decimals, is_verified, created_at, updated_at) VALUES (?, ?, 'T', 'Token', 18, 1, 0, 0)",
    )
      .bind(CHAIN_ID, TOKEN0)
      .run()

    const cronEnv = makeCronEnv()
    await enqueuePriceRefresh(cronEnv as CronEnv)

    expect(cronEnv.queues.priceQueue.send).toHaveBeenCalledWith({
      type: "price-refresh",
      tokens: [TOKEN0],
    })
  })

  it("skips entirely when CHAIN_ID is invalid (no silent fallback to chain 1)", async () => {
    const cronEnv = makeCronEnv({ CHAIN_ID: "not-a-chain" })
    await expect(enqueuePriceRefresh(cronEnv as CronEnv)).resolves.toBeUndefined()
    expect(cronEnv.queues.priceQueue.send).not.toHaveBeenCalled()
  })
})
