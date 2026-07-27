/**
 * Phase 3 indexer — event decoding + idempotent D1 persistence.
 *
 * Worker-pool integration tests: a fake viem PublicClient (injected via
 * `clientFactory`) feeds encoded v3/v4 logs into `IndexerService.indexBatch`,
 * which decodes and writes them to the test D1 database. Each batch is fed
 * twice so the ON CONFLICT guards prove idempotent upserts, and the cursor is
 * asserted to advance past each indexed range.
 */

import { env } from "cloudflare:test"
import { Effect, Layer } from "effect"
import { encodeAbiParameters, encodeEventTopics, getAddress, type Hex, type PublicClient, parseAbiItem } from "viem"
import { beforeAll, describe, expect, it } from "vitest"
import m0001 from "../migrations/0001_initial_schema.sql?raw"
import m0002 from "../migrations/0002_seed_data.sql?raw"
import m0003 from "../migrations/0003_chain_scoped_tokens.sql?raw"
import m0004 from "../migrations/0004_phase1_chain_and_events.sql?raw"
import m0005 from "../migrations/0005_chain_qualified_pool_keys.sql?raw"
import m0006 from "../migrations/0006_chain_qualified_price_cache.sql?raw"
import m0007 from "../migrations/0007_v3_indexer_cursor.sql?raw"
import { makeDbLayer } from "../src/db/client"
import { type IndexerChainConfig, IndexerService, IndexerServiceLive } from "../src/services/indexer.service"
import { V4_POOL_MANAGER_ABI } from "../src/services/indexer-events"

const MIGRATIONS = [m0001, m0002, m0003, m0004, m0005, m0006, m0007]

/**
 * Split a migration script into single statements. Line comments are stripped
 * BEFORE splitting on ";" because the migration comments themselves contain
 * semicolons (e.g. "(users is unaffected); drop the pools FK").
 */
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
  // The last migration ends with foreign_keys = on; the indexer relies on the
  // platform default (off) because pool currencies are not seeded into tokens.
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

interface FakeClientOptions {
  readonly logs: readonly FakeLog[]
  readonly startHead: bigint
  readonly headStep: bigint
}

/** Deterministic stand-in for the viem PublicClient the indexer drives. */
const makeFakeClient = (options: FakeClientOptions): PublicClient => {
  let head = options.startHead
  const timestampFor = (blockNumber: bigint) => 1_700_000_000n + blockNumber * 12n
  const fake = {
    getBlockNumber: (): Promise<bigint> => {
      const current = head
      head += options.headStep
      return Promise.resolve(current)
    },
    getLogs: (): Promise<readonly FakeLog[]> => Promise.resolve(options.logs),
    getBlock: (params: { blockNumber: bigint }): Promise<{ timestamp: bigint }> =>
      Promise.resolve({ timestamp: timestampFor(params.blockNumber) }),
  }
  return fake as unknown as PublicClient
}

const fakeLog = (
  address: `0x${string}`,
  encoded: { data: Hex; topics: readonly Hex[] },
  args: { transactionHash: `0x${string}`; logIndex: number; blockNumber: bigint },
): FakeLog => ({ address, data: encoded.data, topics: encoded.topics, ...args })

const runWithService = <A>(
  config: IndexerChainConfig,
  program: (svc: IndexerService) => Effect.Effect<A, never, never>,
): Promise<A> =>
  Effect.runPromise(
    Effect.gen(function* () {
      const svc = yield* IndexerService
      return yield* program(svc)
    }).pipe(Effect.provide(IndexerServiceLive([config]).pipe(Layer.provide(makeDbLayer(env.DB))))),
  )

const count = async (table: string, chainId: number): Promise<number> => {
  const row = await env.DB.prepare(`SELECT COUNT(*) AS c FROM ${table} WHERE chain_id = ?`)
    .bind(chainId)
    .first<{ c: number }>()
  return row?.c ?? 0
}

beforeAll(async () => {
  await applyMigrations(env.DB)
})

describe("IndexerService v4_pool_manager persistence", () => {
  const POOL_MANAGER = "0x0000000000000000000000000000000000044444" as const
  const POOL_ID = `0x${"ab".repeat(32)}`
  const CURRENCY0 = "0x0000000000000000000000000000000000000a01"
  const CURRENCY1 = "0x0000000000000000000000000000000000000b02"
  const HOOKS = "0x00000000000000000000000000000000000c0de0"
  const TRADER = "0x000000000000000000000000000000000000feed"
  const TX_INIT = `0x${"a1".repeat(32)}` as const
  const TX_SWAP = `0x${"a2".repeat(32)}` as const
  const TX_ML = `0x${"a3".repeat(32)}` as const

  const encodeV4 = (
    eventName: "Initialize" | "ModifyLiquidity" | "Swap",
    indexedArgs: Record<string, unknown>,
    params: readonly { readonly type: string }[],
    values: readonly unknown[],
  ): { data: Hex; topics: readonly Hex[] } => ({
    topics: encodeEventTopics({ abi: V4_POOL_MANAGER_ABI, eventName, args: indexedArgs }),
    data: encodeAbiParameters(params, values),
  })

  const v4Logs: readonly FakeLog[] = [
    fakeLog(
      POOL_MANAGER,
      encodeV4(
        "Initialize",
        { id: POOL_ID, currency0: CURRENCY0, currency1: CURRENCY1 },
        [{ type: "uint24" }, { type: "int24" }, { type: "address" }, { type: "uint160" }, { type: "int24" }],
        [3000, 60, HOOKS, 79228162514264337593543950336n, -7],
      ),
      { transactionHash: TX_INIT, logIndex: 0, blockNumber: 105n },
    ),
    fakeLog(
      POOL_MANAGER,
      encodeV4(
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
      { transactionHash: TX_SWAP, logIndex: 1, blockNumber: 106n },
    ),
    fakeLog(
      POOL_MANAGER,
      encodeV4(
        "ModifyLiquidity",
        { id: POOL_ID, sender: TRADER },
        [{ type: "int24" }, { type: "int24" }, { type: "int256" }, { type: "bytes32" }],
        [-120, 120, -555n, `0x${"11".repeat(32)}`],
      ),
      { transactionHash: TX_ML, logIndex: 2, blockNumber: 106n },
    ),
  ]

  // One client shared by every layer built in this suite so the advancing head
  // counter spans both indexBatch runs (head 200 → 500).
  const sharedClient = makeFakeClient({ logs: v4Logs, startHead: 200n, headStep: 300n })

  const chainConfig: IndexerChainConfig = {
    chainId: 1,
    rpcUrl: "http://fake-rpc.invalid",
    batchSize: 500,
    contracts: { v4PoolManager: POOL_MANAGER },
    genesisBlock: 100n,
    clientFactory: () => sharedClient,
  }

  it("decodes Initialize/Swap/ModifyLiquidity, persists idempotently, and advances the cursor", async () => {
    // First pass: head = 200 → range 100..200 → cursor 201.
    const r1 = await runWithService(chainConfig, (svc) => svc.indexBatch(1, "v4_pool_manager"))
    expect(r1).toMatchObject({
      source: "v4_pool_manager",
      fromBlock: 100n,
      toBlock: 200n,
      eventsProcessed: 3,
      cursorAdvanced: true,
    })

    // Pool created from Initialize, then updated by Swap (tick/liquidity).
    const pool = await env.DB.prepare("SELECT * FROM pools WHERE chain_id = ? AND pool_id = ?")
      .bind(1, POOL_ID)
      .first<Record<string, unknown>>()
    expect(pool).toMatchObject({
      pool_id: POOL_ID,
      token0_address: getAddress(CURRENCY0),
      token1_address: getAddress(CURRENCY1),
      fee: 3000,
      tick_spacing: 60,
      hook_address: getAddress(HOOKS),
      current_tick: 5,
      liquidity: "777777",
      is_active: 1,
    })

    // Swap recorded once, with token direction inferred from the amount0 sign
    // (amount0 < 0 ⇒ currency0 leaves the pool, so it is the trader's tokenOut).
    const swap = await env.DB.prepare("SELECT * FROM transactions WHERE chain_id = ? AND tx_hash = ?")
      .bind(1, TX_SWAP)
      .first<Record<string, unknown>>()
    expect(swap).toMatchObject({
      tx_type: "swap",
      user_address: getAddress(TRADER),
      pool_id: POOL_ID,
      token_in: getAddress(CURRENCY1),
      token_out: getAddress(CURRENCY0),
      amount_in: "2500",
      amount_out: "1000",
      block_number: 106,
      block_timestamp: 1_700_000_000 + 106 * 12,
    })

    // The swap's user FK is satisfied by an indexer-seeded user row.
    const user = await env.DB.prepare("SELECT address FROM users WHERE address = ?").bind(getAddress(TRADER)).first()
    expect(user).not.toBeNull()

    // ModifyLiquidity → one v4 liquidity event keyed by (chain, tx, log_index).
    const ml = await env.DB.prepare("SELECT * FROM liquidity_events WHERE chain_id = ? AND tx_hash = ?")
      .bind(1, TX_ML)
      .first<Record<string, unknown>>()
    expect(ml).toMatchObject({
      protocol: "v4",
      event_type: "decrease",
      pool_id: POOL_ID,
      token_id: null,
      owner_address: getAddress(TRADER),
      tick_lower: -120,
      tick_upper: 120,
      liquidity_delta: "-555",
      block_timestamp: 1_700_000_000 + 106 * 12,
    })

    // Second pass: same logs fed again over a fresh range (head 500) — the
    // conflict guards must keep every table at exactly one row per event.
    const r2 = await runWithService(chainConfig, (svc) => svc.indexBatch(1, "v4_pool_manager"))
    expect(r2).toMatchObject({ fromBlock: 201n, toBlock: 500n, eventsProcessed: 3, cursorAdvanced: true })

    expect(await count("pools", 1)).toBe(1)
    expect(await count("transactions", 1)).toBe(1)
    expect(await count("liquidity_events", 1)).toBe(1)

    const cursor = await runWithService(chainConfig, (svc) => svc.getCursor(1, "v4_pool_manager"))
    expect(cursor?.nextBlock).toBe(501n)
  })
})

describe("IndexerService v3_position_manager persistence", () => {
  const MANAGER = "0x0000000000000000000000000000000000000100" as const
  const TX_INC = `0x${"b1".repeat(32)}` as const

  const increaseEvent = parseAbiItem(
    "event IncreaseLiquidity(uint256 indexed tokenId, uint128 liquidity, uint256 amount0, uint256 amount1)",
  )
  const v3Logs: readonly FakeLog[] = [
    fakeLog(
      MANAGER,
      {
        topics: encodeEventTopics({ abi: [increaseEvent], eventName: "IncreaseLiquidity", args: [42n] }),
        data: encodeAbiParameters([{ type: "uint128" }, { type: "uint256" }, { type: "uint256" }], [900n, 10n, 20n]),
      },
      { transactionHash: TX_INC, logIndex: 0, blockNumber: 55n },
    ),
  ]

  const sharedClient = makeFakeClient({ logs: v3Logs, startHead: 60n, headStep: 100n })

  const chainConfig: IndexerChainConfig = {
    chainId: 2,
    rpcUrl: "http://fake-rpc.invalid",
    batchSize: 500,
    contracts: { v3PositionManager: MANAGER },
    genesisBlock: 50n,
    clientFactory: () => sharedClient,
  }

  it("persists parsed v3 position-manager events once across overlapping batches", async () => {
    const r1 = await runWithService(chainConfig, (svc) => svc.indexBatch(2, "v3_position_manager"))
    expect(r1).toMatchObject({ source: "v3_position_manager", eventsProcessed: 1, cursorAdvanced: true })

    const row = await env.DB.prepare("SELECT * FROM liquidity_events WHERE chain_id = ? AND tx_hash = ?")
      .bind(2, TX_INC)
      .first<Record<string, unknown>>()
    expect(row).toMatchObject({
      protocol: "v3",
      event_type: "increase",
      token_id: "42",
      liquidity_delta: "900",
      amount0: "10",
      amount1: "20",
      block_timestamp: 1_700_000_000 + 55 * 12,
    })

    // Re-run over a fresh range: the (chain_id, tx_hash, log_index) guard keeps a single row.
    const r2 = await runWithService(chainConfig, (svc) => svc.indexBatch(2, "v3_position_manager"))
    expect(r2).toMatchObject({ eventsProcessed: 1, cursorAdvanced: true })
    expect(await count("liquidity_events", 2)).toBe(1)

    const cursor = await runWithService(chainConfig, (svc) => svc.getCursor(2, "v3_position_manager"))
    expect(cursor?.nextBlock).toBe(161n)
  })
})
