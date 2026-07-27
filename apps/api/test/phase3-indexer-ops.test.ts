/**
 * Phase 3 indexer ops — cron tick + queue backfill wiring.
 *
 * Worker-pool integration tests driving the REAL handlers (runPhase3Indexer,
 * processQueueBatch) against the test D1 database with a fake viem PublicClient
 * injected through the clientFactory seam — no network calls.
 *
 *   chain 3 → cron tick: indexes configured sources + advances the cursor
 *   chain 4 → queue backfill: indexes a fixed range, idempotent, cursor untouched
 *   chain 5 → disabled/unconfigured: no-op
 */

import { env } from "cloudflare:test"
import { encodeAbiParameters, encodeEventTopics, type Hex, type PublicClient } from "viem"
import { beforeAll, describe, expect, it, vi } from "vitest"
import m0001 from "../migrations/0001_initial_schema.sql?raw"
import m0002 from "../migrations/0002_seed_data.sql?raw"
import m0003 from "../migrations/0003_chain_scoped_tokens.sql?raw"
import m0004 from "../migrations/0004_phase1_chain_and_events.sql?raw"
import m0005 from "../migrations/0005_chain_qualified_pool_keys.sql?raw"
import m0006 from "../migrations/0006_chain_qualified_price_cache.sql?raw"
import m0007 from "../migrations/0007_v3_indexer_cursor.sql?raw"
import { V4_POOL_MANAGER_ABI } from "../src/services/indexer-events"
import type { CronEnv } from "../src/workers/cron-handler"
import { runPhase3Indexer } from "../src/workers/cron-handler"
import type { IndexerBackfillMessage, QueueEnv } from "../src/workers/queue-handler"
import { processQueueBatch } from "../src/workers/queue-handler"

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
  await db.prepare("PRAGMA foreign_keys = OFF").run()
}

interface FakeLog {
  readonly address: `0x${string}`
  readonly data: Hex
  readonly topics: readonly Hex[]
  readonly transactionHash: `0x${string}`
  readonly logIndex: number
  readonly blockNumber: bigint
}

const makeFakeClient = (options: {
  readonly logs: readonly FakeLog[]
  readonly startHead: bigint
  readonly headStep: bigint
}): PublicClient => {
  let head = options.startHead
  const fake = {
    getBlockNumber: (): Promise<bigint> => {
      const current = head
      head += options.headStep
      return Promise.resolve(current)
    },
    getLogs: (): Promise<readonly FakeLog[]> => Promise.resolve(options.logs),
    getBlock: (params: { blockNumber: bigint }): Promise<{ timestamp: bigint }> =>
      Promise.resolve({ timestamp: 1_700_000_000n + params.blockNumber * 12n }),
  }
  return fake as unknown as PublicClient
}

const POOL_MANAGER = "0x0000000000000000000000000000000000055555" as const
const POOL_ID = `0x${"cd".repeat(32)}`
const CURRENCY0 = "0x0000000000000000000000000000000000000d01"
const CURRENCY1 = "0x0000000000000000000000000000000000000e02"
const HOOKS = "0x00000000000000000000000000000000000d0de0"
const TRADER = "0x000000000000000000000000000000000000beef"
const TX_INIT = `0x${"c1".repeat(32)}` as const
const TX_SWAP = `0x${"c2".repeat(32)}` as const

const encodeV4 = (
  eventName: "Initialize" | "Swap",
  indexedArgs: Record<string, unknown>,
  params: readonly { readonly type: string }[],
  values: readonly unknown[],
): { data: Hex; topics: readonly Hex[] } => ({
  topics: encodeEventTopics({ abi: V4_POOL_MANAGER_ABI, eventName, args: indexedArgs }),
  data: encodeAbiParameters(params, values),
})

const v4Logs: readonly FakeLog[] = [
  {
    address: POOL_MANAGER,
    ...encodeV4(
      "Initialize",
      { id: POOL_ID, currency0: CURRENCY0, currency1: CURRENCY1 },
      [{ type: "uint24" }, { type: "int24" }, { type: "address" }, { type: "uint160" }, { type: "int24" }],
      [3000, 60, HOOKS, 79228162514264337593543950336n, -7],
    ),
    transactionHash: TX_INIT,
    logIndex: 0,
    blockNumber: 105n,
  },
  {
    address: POOL_MANAGER,
    ...encodeV4(
      "Swap",
      { id: POOL_ID, sender: TRADER },
      [
        { type: "int128" },
        { type: "int128" },
        { type: "uint160" },
        { type: "uint128" },
        { type: "int24" },
        { type: "uint24" },
      ],
      [-1000n, 2500n, 79328000000000000000000000000n, 777777n, 5, 3000],
    ),
    transactionHash: TX_SWAP,
    logIndex: 1,
    blockNumber: 106n,
  },
]

const count = async (table: string, chainId: number): Promise<number> => {
  const row = await env.DB.prepare(`SELECT COUNT(*) AS c FROM ${table} WHERE chain_id = ?`)
    .bind(chainId)
    .first<{ c: number }>()
  return row?.c ?? 0
}

const cursorFor = async (chainId: number, source: string): Promise<bigint | null> => {
  const row = await env.DB.prepare("SELECT next_block FROM indexer_cursors WHERE chain_id = ? AND indexer = ?")
    .bind(chainId, source)
    .first<{ next_block: string }>()
  return row ? BigInt(row.next_block) : null
}

const makeCronEnv = (overrides: Partial<CronEnv> = {}): CronEnv => ({
  DB: env.DB,
  CACHE: {} as unknown as KVNamespace,
  STORAGE: {} as unknown as R2Bucket,
  PRICE_QUEUE: {} as unknown as Queue,
  SETTLE_QUEUE: {} as unknown as Queue,
  KEEPER_QUEUE: {} as unknown as Queue,
  CHAIN_ID: "3",
  ...overrides,
})

const makeQueueEnv = (overrides: Partial<QueueEnv> = {}): QueueEnv => ({
  DB: env.DB,
  CACHE: {} as unknown as KVNamespace,
  STORAGE: {} as unknown as R2Bucket,
  WEBSOCKET_HUB: {} as unknown as DurableObjectNamespace,
  CHAIN_ID: "4",
  ...overrides,
})

const sendBackfill = async (
  body: IndexerBackfillMessage,
  queueEnv: QueueEnv,
  factory?: (rpcUrl: string) => PublicClient,
) => {
  const ack = vi.fn()
  const retry = vi.fn()
  const batch = {
    queue: "indexer-backfill",
    messages: [{ id: "m1", timestamp: new Date(), attempts: 0, body, ack, retry }],
  } as unknown as MessageBatch<unknown>
  await processQueueBatch(batch, queueEnv, factory)
  return { ack, retry }
}

beforeAll(async () => {
  await applyMigrations(env.DB)
})

describe("runPhase3Indexer (cron tick)", () => {
  it("indexes configured sources with the injected client and advances the cursor", async () => {
    const factory = vi.fn(() => makeFakeClient({ logs: v4Logs, startHead: 10_200n, headStep: 0n }))

    await runPhase3Indexer(
      makeCronEnv({
        RPC_URL: "http://fake-rpc.invalid",
        INDEXER_ENABLED: "true",
        INDEXER_BATCH_SIZE: "500",
        V4_POOL_MANAGER_ADDRESS: POOL_MANAGER,
      }),
      factory,
    )

    expect(factory).toHaveBeenCalledOnce()

    expect(await count("pools", 3)).toBe(1)
    expect(await count("transactions", 3)).toBe(1)

    // No genesis configured → start = head - 10_000 = 200; +500 batch → 700.
    expect(await cursorFor(3, "v4_pool_manager")).toBe(701n)
    // Unconfigured v3 sources still advance their empty windows without rows.
    expect(await cursorFor(3, "v3_position_manager")).toBe(701n)
  })

  it("is a no-op when INDEXER_ENABLED != true", async () => {
    const factory = vi.fn(() => makeFakeClient({ logs: v4Logs, startHead: 20_000n, headStep: 0n }))

    await runPhase3Indexer(
      makeCronEnv({
        CHAIN_ID: "5",
        RPC_URL: "http://fake-rpc.invalid",
        INDEXER_ENABLED: "false",
        V4_POOL_MANAGER_ADDRESS: POOL_MANAGER,
      }),
      factory,
    )

    expect(factory).not.toHaveBeenCalled()
    expect(await count("pools", 5)).toBe(0)
    expect(await cursorFor(5, "v4_pool_manager")).toBeNull()
  })

  it("is a no-op when enabled but no source contract is configured", async () => {
    const factory = vi.fn(() => makeFakeClient({ logs: v4Logs, startHead: 20_000n, headStep: 0n }))

    await runPhase3Indexer(
      makeCronEnv({
        CHAIN_ID: "5",
        RPC_URL: "http://fake-rpc.invalid",
        INDEXER_ENABLED: "true",
        V4_POOL_MANAGER_ADDRESS: "",
        V3_POSITION_MANAGER_ADDRESS: "not-an-address",
        V3_INDEXED_POOL_ADDRESSES: "garbage, 0x123",
      }),
      factory,
    )

    expect(factory).not.toHaveBeenCalled()
    expect(await cursorFor(5, "v4_pool_manager")).toBeNull()
  })
})

describe("processQueueBatch (indexer-backfill)", () => {
  const backfillBody: IndexerBackfillMessage = {
    type: "indexer-backfill",
    chainId: 4,
    source: "v4_pool_manager",
    fromBlock: "100",
    toBlock: "200",
  }

  const backfillEnv = makeQueueEnv({
    RPC_URL: "http://fake-rpc.invalid",
    INDEXER_ENABLED: "true",
    V4_POOL_MANAGER_ADDRESS: POOL_MANAGER,
  })

  it("indexes the requested range idempotently without touching the global cursor", async () => {
    const factory = () => makeFakeClient({ logs: v4Logs, startHead: 99_999n, headStep: 0n })

    const first = await sendBackfill(backfillBody, backfillEnv, factory)
    expect(first.ack).toHaveBeenCalledOnce()
    expect(first.retry).not.toHaveBeenCalled()

    expect(await count("pools", 4)).toBe(1)
    expect(await count("transactions", 4)).toBe(1)
    expect(await cursorFor(4, "v4_pool_manager")).toBeNull()

    const second = await sendBackfill(backfillBody, backfillEnv, factory)
    expect(second.ack).toHaveBeenCalledOnce()
    expect(second.retry).not.toHaveBeenCalled()

    expect(await count("pools", 4)).toBe(1)
    expect(await count("transactions", 4)).toBe(1)
    expect(await cursorFor(4, "v4_pool_manager")).toBeNull()
  })

  it("acks without retry when the indexer is disabled", async () => {
    const factory = vi.fn(() => makeFakeClient({ logs: v4Logs, startHead: 20_000n, headStep: 0n }))
    const disabledEnv = makeQueueEnv({
      CHAIN_ID: "4",
      RPC_URL: "http://fake-rpc.invalid",
      INDEXER_ENABLED: "false",
      V4_POOL_MANAGER_ADDRESS: POOL_MANAGER,
    })

    const { ack, retry } = await sendBackfill(
      { ...backfillBody, fromBlock: "300", toBlock: "400" },
      disabledEnv,
      factory,
    )

    expect(ack).toHaveBeenCalledOnce()
    expect(retry).not.toHaveBeenCalled()
    expect(factory).not.toHaveBeenCalled()
  })

  it("acks malformed ranges instead of infinite-retrying", async () => {
    const factory = vi.fn(() => makeFakeClient({ logs: v4Logs, startHead: 20_000n, headStep: 0n }))

    const inverted = await sendBackfill({ ...backfillBody, fromBlock: "500", toBlock: "100" }, backfillEnv, factory)
    expect(inverted.ack).toHaveBeenCalledOnce()
    expect(inverted.retry).not.toHaveBeenCalled()

    const nonNumeric = await sendBackfill({ ...backfillBody, fromBlock: "abc", toBlock: "200" }, backfillEnv, factory)
    expect(nonNumeric.ack).toHaveBeenCalledOnce()
    expect(nonNumeric.retry).not.toHaveBeenCalled()

    expect(factory).not.toHaveBeenCalled()
  })
})
