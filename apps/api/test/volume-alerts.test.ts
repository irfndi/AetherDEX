/**
 * Phase 3 — Volume-spike alerts.
 *
 * Worker-pool integration tests covering the whole alert path with NO external
 * network:
 *   - `readVolumeSpikes` threshold / window / null-amount logic on seeded D1
 *   - `readVolumeAlertConfig` defaults + invalid input fallback
 *   - KV cooldown deduplication
 *   - `runVolumeAlertsTick` emit + cooldown suppression with a stubbed hub and a
 *     mocked Telegram `fetch`
 *   - `VolumeAlertHubDO` WebSocket fan-out (all / per-pool / canonicalization)
 */

import { env, SELF } from "cloudflare:test"
import { beforeAll, describe, expect, it, vi } from "vitest"
import m0001 from "../migrations/0001_initial_schema.sql?raw"
import m0002 from "../migrations/0002_seed_data.sql?raw"
import m0003 from "../migrations/0003_chain_scoped_tokens.sql?raw"
import m0004 from "../migrations/0004_phase1_chain_and_events.sql?raw"
import m0005 from "../migrations/0005_chain_qualified_pool_keys.sql?raw"
import m0006 from "../migrations/0006_chain_qualified_price_cache.sql?raw"
import m0007 from "../migrations/0007_v3_indexer_cursor.sql?raw"
import {
  cooldownKey,
  isInCooldown,
  markCooldown,
  readVolumeAlertConfig,
  readVolumeSpikes,
  runVolumeAlertsTick,
  sendTelegramAlert,
  type VolumeAlert,
  type VolumeAlertConfig,
} from "../src/services/volume-alerts.service"

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
  // The last migration ends with foreign_keys = on; seeds omit users/pools parents.
  await db.prepare("PRAGMA foreign_keys = OFF").run()
}

// Fixed wall-clock so window math is deterministic (created_at is stored in ms).
const NOW = 1_700_000_000_000
const WINDOW_SECONDS = 300
const THRESHOLD = 1000

const POOL_A = `0x${"a1".repeat(32)}`
const POOL_B = `0x${"b2".repeat(32)}`
const POOL_C = `0x${"c3".repeat(32)}`

// Parent rows the transactions FKs require (users.address + pools.(chain_id,pool_id)).
// pools has no tokens FK after 0003, so token addresses are free-form placeholders.
const USER = "0x00000000000000000000000000000000000000aa"
const TOKEN0 = "0x0000000000000000000000000000000000000701"
const TOKEN1 = "0x0000000000000000000000000000000000000702"

const seededPools = new Set<string>()
let userSeeded = false

const ensureUser = async (): Promise<void> => {
  if (userSeeded) return
  await env.DB.prepare(
    "INSERT OR IGNORE INTO users (address, nonce, first_seen_at, last_active_at, tx_count, total_volume_usd) VALUES (?, 'va-test-nonce', 0, 0, 0, 0)",
  )
    .bind(USER)
    .run()
  userSeeded = true
}

const ensurePool = async (chainId: number, poolId: string): Promise<void> => {
  const key = `${chainId}:${poolId}`
  if (seededPools.has(key)) return
  await env.DB.prepare(
    `INSERT OR IGNORE INTO pools
       (chain_id, pool_id, token0_address, token1_address, fee, tick_spacing, hook_address, sqrt_price_x96, current_tick, liquidity, tvl_usd, volume_24h_usd, fees_24h_usd, is_active, created_at, updated_at)
     VALUES (?, ?, ?, ?, 3000, 60, NULL, '0', 0, '0', 0, 0, 0, 1, 0, 0)`,
  )
    .bind(chainId, poolId, TOKEN0, TOKEN1)
    .run()
  seededPools.add(key)
}

let txCounter = 0
const seedTx = async (p: {
  chainId: number
  poolId: string | null
  amountUsd: number | null
  createdAt: number
  status?: string
}): Promise<void> => {
  await ensureUser()
  if (p.poolId !== null) await ensurePool(p.chainId, p.poolId)
  await env.DB.prepare(
    `INSERT INTO transactions
       (tx_hash, user_address, pool_id, tx_type, amount_usd, block_number, block_timestamp, status, created_at, chain_id)
     VALUES (?, ?, ?, 'swap', ?, 1, ?, ?, ?, ?)`,
  )
    .bind(
      `0x${"f0".repeat(31)}${(txCounter++).toString(16).padStart(2, "0")}`,
      USER,
      p.poolId,
      p.amountUsd,
      p.createdAt,
      p.status ?? "confirmed",
      p.createdAt,
      p.chainId,
    )
    .run()
}

const makeStubHub = (): { hub: DurableObjectNamespace; fetch: ReturnType<typeof vi.fn> } => {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }))
  const hub = {
    idFromName: () => ({}),
    get: () => ({ fetch: fetchMock }),
  } as unknown as DurableObjectNamespace
  return { hub, fetch: fetchMock }
}

const makeTelegramMock = () =>
  vi.fn(async () => new Response("{}", { status: 200 })) as unknown as ReturnType<typeof vi.fn>

interface AlertMsg {
  type: string
  poolId?: string
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const nextMessage = (ws: WebSocket): Promise<AlertMsg> =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timed out waiting for WS message")), 5000)
    ws.addEventListener("message", (event) => {
      clearTimeout(timer)
      resolve(JSON.parse(String(event.data)) as AlertMsg)
    })
    ws.addEventListener("error", () => {
      clearTimeout(timer)
      reject(new Error("socket error"))
    })
  })

const collect = (ws: WebSocket): AlertMsg[] => {
  const msgs: AlertMsg[] = []
  ws.addEventListener("message", (event) => {
    msgs.push(JSON.parse(String(event.data)) as AlertMsg)
  })
  return msgs
}

const connect = (path: string): Promise<WebSocket> =>
  SELF.fetch(`http://fake-host${path}`, { headers: { Upgrade: "websocket" } }).then((res) => {
    expect(res.status).toBe(101)
    const socket = res.webSocket as WebSocket
    expect(socket).not.toBeNull()
    socket.accept()
    return socket
  })

const sampleAlert = (poolId = POOL_A): VolumeAlert => ({
  type: "volume_alert",
  chainId: 1,
  poolId,
  volumeUsd: "5000",
  thresholdUsd: String(THRESHOLD),
  windowSeconds: WINDOW_SECONDS,
  timestamp: NOW,
})

beforeAll(async () => {
  await applyMigrations(env.DB)
})

describe("readVolumeSpikes", () => {
  const CHAIN = 701

  it("returns only in-window pools whose positive volume exceeds the threshold", async () => {
    // Pool A: 600 + 700 = 1300 (in window) — plus a null and a zero amount that must be ignored.
    await seedTx({ chainId: CHAIN, poolId: POOL_A, amountUsd: 600, createdAt: NOW - 10_000 })
    await seedTx({ chainId: CHAIN, poolId: POOL_A, amountUsd: 700, createdAt: NOW - 20_000 })
    await seedTx({ chainId: CHAIN, poolId: POOL_A, amountUsd: null, createdAt: NOW - 30_000 })
    await seedTx({ chainId: CHAIN, poolId: POOL_A, amountUsd: 0, createdAt: NOW - 40_000 })
    // Pool B: 500 (below threshold).
    await seedTx({ chainId: CHAIN, poolId: POOL_B, amountUsd: 500, createdAt: NOW - 10_000 })
    // Pool C: huge but outside the window.
    await seedTx({ chainId: CHAIN, poolId: POOL_C, amountUsd: 99_999, createdAt: NOW - WINDOW_SECONDS * 1000 - 1000 })
    // No pool id — never counted.
    await seedTx({ chainId: CHAIN, poolId: null, amountUsd: 5000, createdAt: NOW - 1000 })

    const spikes = await readVolumeSpikes(env.DB, {
      chainId: CHAIN,
      windowSeconds: WINDOW_SECONDS,
      thresholdUsd: THRESHOLD,
      now: NOW,
    })

    expect(spikes).toHaveLength(1)
    expect(spikes[0]).toMatchObject({
      poolId: POOL_A,
      volumeUsd: 1300,
      windowSeconds: WINDOW_SECONDS,
      thresholdUsd: THRESHOLD,
    })
  })

  it("returns nothing when every pool is below the threshold", async () => {
    const spikes = await readVolumeSpikes(env.DB, {
      chainId: CHAIN,
      windowSeconds: WINDOW_SECONDS,
      thresholdUsd: 10_000,
      now: NOW,
    })
    expect(spikes).toHaveLength(0)
  })

  it("scopes to the requested chain", async () => {
    const spikes = await readVolumeSpikes(env.DB, {
      chainId: 999,
      windowSeconds: WINDOW_SECONDS,
      thresholdUsd: THRESHOLD,
      now: NOW,
    })
    expect(spikes).toHaveLength(0)
  })
})

describe("readVolumeAlertConfig", () => {
  it("applies safe defaults when only a valid chain id is given", () => {
    expect(readVolumeAlertConfig({ CHAIN_ID: "1" })).toEqual({
      chainId: 1,
      windowSeconds: 300,
      thresholdUsd: 1_000_000,
      cooldownSeconds: 900,
    })
  })

  it("returns null for a missing or invalid chain id", () => {
    expect(readVolumeAlertConfig({ CHAIN_ID: "" })).toBeNull()
    expect(readVolumeAlertConfig({ CHAIN_ID: "abc" })).toBeNull()
  })

  it("overrides valid knobs and falls back invalid ones", () => {
    expect(
      readVolumeAlertConfig({
        CHAIN_ID: "11155111",
        VOLUME_ALERT_WINDOW_SECONDS: "60",
        VOLUME_ALERT_THRESHOLD_USD: "bogus",
        VOLUME_ALERT_COOLDOWN_SECONDS: "120",
      }),
    ).toEqual({ chainId: 11155111, windowSeconds: 60, thresholdUsd: 1_000_000, cooldownSeconds: 120 })
  })
})

describe("KV cooldown", () => {
  const CHAIN = 702

  it("is clear until marked, then suppresses the same pool only", async () => {
    expect(cooldownKey(CHAIN, POOL_A)).toBe(`va:cooldown:${CHAIN}:${POOL_A}`)

    expect(await isInCooldown(env.CACHE, CHAIN, POOL_A)).toBe(false)
    await markCooldown(env.CACHE, CHAIN, POOL_A, 900)
    expect(await isInCooldown(env.CACHE, CHAIN, POOL_A)).toBe(true)

    // A different pool on the same chain is unaffected.
    expect(await isInCooldown(env.CACHE, CHAIN, POOL_B)).toBe(false)
  })
})

describe("runVolumeAlertsTick", () => {
  const CHAIN = 703
  const config: VolumeAlertConfig = {
    chainId: CHAIN,
    windowSeconds: WINDOW_SECONDS,
    thresholdUsd: THRESHOLD,
    cooldownSeconds: 900,
  }

  it("emits an alert, broadcasts, notifies Telegram, then cools down", async () => {
    await seedTx({ chainId: CHAIN, poolId: POOL_A, amountUsd: 2000, createdAt: NOW - 1000 })

    const { hub, fetch: broadcast } = makeStubHub()
    const telegram = makeTelegramMock()

    const first = await runVolumeAlertsTick(
      env.DB,
      env.CACHE,
      config,
      { hub, telegram: { TELEGRAM_BOT_TOKEN: "tok", TELEGRAM_CHAT_ID: "chat" }, fetchImpl: telegram },
      NOW,
    )

    expect(first).toHaveLength(1)
    expect(first[0]).toMatchObject({ type: "volume_alert", chainId: CHAIN, poolId: POOL_A, volumeUsd: "2000" })
    expect(broadcast).toHaveBeenCalledTimes(1)
    expect(telegram).toHaveBeenCalledTimes(1)
    expect(String(telegram.mock.calls[0][0])).toBe("https://api.telegram.org/bottok/sendMessage")

    // Second tick: the cooldown suppresses re-delivery for the sustained spike.
    const second = await runVolumeAlertsTick(
      env.DB,
      env.CACHE,
      config,
      { hub, telegram: { TELEGRAM_BOT_TOKEN: "tok", TELEGRAM_CHAT_ID: "chat" }, fetchImpl: telegram },
      NOW,
    )
    expect(second).toHaveLength(0)
    expect(broadcast).toHaveBeenCalledTimes(1)
    expect(telegram).toHaveBeenCalledTimes(1)
  })

  it("is a no-op with no spikes: no broadcast, no Telegram", async () => {
    const { hub, fetch: broadcast } = makeStubHub()
    const telegram = makeTelegramMock()

    const emitted = await runVolumeAlertsTick(
      env.DB,
      env.CACHE,
      { chainId: 704, windowSeconds: WINDOW_SECONDS, thresholdUsd: THRESHOLD, cooldownSeconds: 900 },
      { hub, telegram: {}, fetchImpl: telegram },
      NOW,
    )

    expect(emitted).toHaveLength(0)
    expect(broadcast).not.toHaveBeenCalled()
    expect(telegram).not.toHaveBeenCalled()
  })
})

describe("sendTelegramAlert", () => {
  it("skips the network entirely when unconfigured", async () => {
    const telegram = makeTelegramMock()
    await sendTelegramAlert({}, sampleAlert(), telegram)
    expect(telegram).not.toHaveBeenCalled()
  })

  it("never throws on a delivery failure", async () => {
    const failing = vi.fn(async () => {
      throw new Error("network down")
    }) as unknown as ReturnType<typeof makeTelegramMock>
    await expect(
      sendTelegramAlert({ TELEGRAM_BOT_TOKEN: "t", TELEGRAM_CHAT_ID: "c" }, sampleAlert(), failing),
    ).resolves.toBeUndefined()
    expect(failing).toHaveBeenCalledTimes(1)
  })
})

describe("VolumeAlertHubDO broadcast", () => {
  const POOL_X = `0x${"d4".repeat(32)}`
  const POOL_Y = `0x${"e5".repeat(32)}`

  it("fans alerts to all + matching per-pool subscribers only", async () => {
    const hubNs = env.VOLUME_ALERT_HUB
    if (!hubNs) throw new Error("VOLUME_ALERT_HUB binding is not configured in the test environment")
    const hub = hubNs.getByName("volume-alerts")
    const post = (alert: VolumeAlert) =>
      hub.fetch(new Request("http://volume-alert-hub/alert", { method: "POST", body: JSON.stringify(alert) }))

    const allWs = await connect("/ws/alerts")
    const xWs = await connect(`/ws/alerts/${POOL_X}`)
    const yWs = await connect(`/ws/alerts/${POOL_Y}`)

    const allMsgs = collect(allWs)
    const xMsgs = collect(xWs)
    const yMsgs = collect(yWs)

    const alertX = sampleAlert(POOL_X)
    const alertY = sampleAlert(POOL_Y)
    expect((await post(alertX)).status).toBe(200)
    expect((await post(alertY)).status).toBe(200)
    await delay(50)

    // Global subscriber receives both; per-pool subscribers receive only their own.
    expect(allMsgs.map((m) => m.poolId).sort()).toEqual([POOL_X, POOL_Y].sort())
    expect(xMsgs.map((m) => m.poolId)).toEqual([POOL_X])
    expect(yMsgs.map((m) => m.poolId)).toEqual([POOL_Y])

    allWs.close(1000, "done")
    xWs.close(1000, "done")
    yWs.close(1000, "done")
  })

  it("canonicalizes a mixed-case pool id on the per-pool route", async () => {
    const hubNs = env.VOLUME_ALERT_HUB
    if (!hubNs) throw new Error("VOLUME_ALERT_HUB binding is not configured in the test environment")
    const hub = hubNs.getByName("volume-alerts")

    const mixed = `0x${"Ab".repeat(32)}`
    const lower = mixed.toLowerCase()
    const ws = await connect(`/ws/alerts/${mixed}`)
    const msgs = collect(ws)

    await hub.fetch(
      new Request("http://volume-alert-hub/alert", { method: "POST", body: JSON.stringify(sampleAlert(lower)) }),
    )
    await delay(50)

    expect(msgs.map((m) => m.poolId)).toEqual([lower])
    ws.close(1000, "done")
  })

  it("answers a ping with a pong", async () => {
    const ws = await connect("/ws/alerts")
    const pong = nextMessage(ws)
    ws.send(JSON.stringify({ type: "ping" }))
    expect((await pong).type).toBe("pong")
    ws.close(1000, "done")
  })

  it("reports subscriber stats", async () => {
    const hubNs = env.VOLUME_ALERT_HUB
    if (!hubNs) throw new Error("VOLUME_ALERT_HUB binding is not configured in the test environment")
    const hub = hubNs.getByName("volume-alerts")

    const ws = await connect("/ws/alerts")
    const stats = (await (await hub.fetch("http://volume-alert-hub/stats")).json()) as { subscribers: number }
    expect(stats.subscribers).toBeGreaterThan(0)
    ws.close(1000, "done")
  })

  it("rejects an invalid pool id with 400 (no upgrade)", async () => {
    const res = await SELF.fetch("http://fake-host/ws/alerts/not-a-pool-id", {
      headers: { Upgrade: "websocket" },
    })
    expect(res.status).toBe(400)
    expect(res.webSocket).toBeNull()
    await res.text()
  })
})
