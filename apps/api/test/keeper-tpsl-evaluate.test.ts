/**
 * Phase 2/3 keeper relayer — TP/SL evaluate+execute orchestration through the
 * real queue handler against the test D1 database, with a fake signer injected
 * via the `signerFactory` seam. Verifies AetherTPSL.executeOrder encoding,
 * the pending-preserved behaviour on disabled/deterministic failures, and
 * queue retry on transient errors. No network access.
 */

import { env } from "cloudflare:test"
import { parseEther } from "viem"
import { beforeAll, describe, expect, it, vi } from "vitest"
import m0001 from "../migrations/0001_initial_schema.sql?raw"
import m0002 from "../migrations/0002_seed_data.sql?raw"
import m0003 from "../migrations/0003_chain_scoped_tokens.sql?raw"
import m0004 from "../migrations/0004_phase1_chain_and_events.sql?raw"
import m0005PoolKeys from "../migrations/0005_chain_qualified_pool_keys.sql?raw"
import m0005TpSl from "../migrations/0005_tp_sl_orders.sql?raw"
import m0006 from "../migrations/0006_chain_qualified_price_cache.sql?raw"
import m0007 from "../migrations/0007_v3_indexer_cursor.sql?raw"
import {
  encodeExecuteOrder,
  InsufficientKeeperBalanceError,
  KeeperRpcError,
  type SendTransactionInput,
  type SubmissionResult,
} from "../src/lib/keeper-signer"
import {
  type KeeperSignerFactory,
  processQueueBatch,
  type QueueEnv,
  type TpSlEvaluateMessage,
} from "../src/workers/queue-handler"

const MIGRATIONS = [m0001, m0002, m0003, m0004, m0005PoolKeys, m0005TpSl, m0006, m0007]

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

const TPSL_ADDRESS = "0x1111111111111111111111111111111111111111"
const USER_ADDRESS = "0x3333333333333333333333333333333333333333"
const TX_HASH = `0x${"cd".repeat(32)}`
const PRICES = { spot: "2000000000000000000", twap: "2000000000000000000", trigger: "1500000000000000000" }

const poolIdFor = (index: number): string => `0x${String(index).padStart(64, "0")}`

const makeQueueEnv = (vars: Record<string, string> = { TPSL_ADDRESS }): QueueEnv => ({
  DB: env.DB,
  CACHE: env.CACHE,
  STORAGE: env.STORAGE,
  WEBSOCKET_HUB: env.WEBSOCKET_HUB,
  CHAIN_ID: "11155111",
  ...vars,
})

const makeMessage = (overrides: Partial<TpSlEvaluateMessage> = {}): TpSlEvaluateMessage => ({
  type: "tp-sl-evaluate",
  orderId: 1,
  poolId: poolIdFor(1),
  orderType: "take_profit",
  zeroForOne: false,
  amountIn: "1000000",
  minAmountOut: "1",
  triggerPriceX18: PRICES.trigger,
  twapWindow: 300,
  slippageBps: 500,
  deadline: Date.now() + 600_000,
  userAddress: USER_ADDRESS,
  chainId: 11155111,
  ...overrides,
})

const seedOrder = async (
  orderId: number,
  poolId: string,
  overrides: { deadline?: number; status?: string } = {},
): Promise<void> => {
  await env.DB.prepare(
    `INSERT INTO tp_sl_orders
       (id, user_address, pool_id, order_type, zero_for_one, amount_in, min_amount_out,
        trigger_price_x18, twap_window, slippage_bps, deadline, status, created_at, chain_id)
     VALUES (?, ?, ?, 'take_profit', 0, '1000000', '1', ?, 300, 500, ?, ?, ?, 11155111)`,
  )
    .bind(
      orderId,
      USER_ADDRESS,
      poolId,
      PRICES.trigger,
      overrides.deadline ?? Date.now() + 600_000,
      overrides.status ?? "pending",
      Date.now(),
    )
    .run()
}

const primePrices = async (poolId: string): Promise<void> => {
  await env.CACHE.put(`poolSpot:${poolId}`, JSON.stringify({ price: PRICES.spot }), { expirationTtl: 300 })
  await env.CACHE.put(`twap:${poolId}:300`, JSON.stringify({ price: PRICES.twap }), { expirationTtl: 300 })
}

const readOrder = async (orderId: number) =>
  env.DB.prepare("SELECT status, execution_tx_hash FROM tp_sl_orders WHERE id = ? AND chain_id = 11155111")
    .bind(orderId)
    .first<{ status: string; execution_tx_hash: string | null }>()

const makeBatch = (body: unknown) => {
  const ack = vi.fn()
  const retry = vi.fn()
  const batch = {
    messages: [{ id: "msg-1", timestamp: new Date(), attempts: 1, body, ack, retry }],
  } as unknown as MessageBatch<unknown>
  return { batch, ack, retry }
}

interface FakeSignerHandle {
  sentInputs: readonly SendTransactionInput[]
  received: () => SendTransactionInput | undefined
  factory: KeeperSignerFactory
}

const makeFakeSigner = (result: SubmissionResult | Error): FakeSignerHandle => {
  const sentInputs: SendTransactionInput[] = []
  const factory: KeeperSignerFactory = () => ({
    address: "0x4444444444444444444444444444444444444444",
    channel: "private-relay",
    sendTransaction: async (input) => {
      sentInputs.push(input)
      if (result instanceof Error) throw result
      return result
    },
  })
  return { sentInputs, received: () => sentInputs[0], factory }
}

describe("processQueueBatch (tp-sl-evaluate)", () => {
  it("submits AetherTPSL.executeOrder via the signer and records the tx hash when the dual trigger breaches", async () => {
    const poolId = poolIdFor(1)
    await seedOrder(1, poolId)
    await primePrices(poolId)

    const signer = makeFakeSigner({ kind: "submitted", channel: "private-relay", txHash: TX_HASH })
    const { batch, ack, retry } = makeBatch(makeMessage({ orderId: 1, poolId }))

    await processQueueBatch(batch, makeQueueEnv(), undefined, signer.factory)

    expect(signer.sentInputs).toHaveLength(1)
    expect(signer.received()).toMatchObject({ to: TPSL_ADDRESS, chainId: 11155111 })
    expect(signer.received()?.data).toBe(encodeExecuteOrder(1))

    const order = await readOrder(1)
    expect(order).toEqual({ status: "triggered", execution_tx_hash: TX_HASH })
    expect(ack).toHaveBeenCalledTimes(1)
    expect(retry).not.toHaveBeenCalled()
  })

  it("keeps the order pending when submission is disabled (evaluation-only default)", async () => {
    const poolId = poolIdFor(2)
    await seedOrder(2, poolId)
    await primePrices(poolId)

    const signer = makeFakeSigner({
      kind: "submission-disabled",
      reason: "no relay and no public opt-in",
    })
    const { batch, ack, retry } = makeBatch(makeMessage({ orderId: 2, poolId }))

    await processQueueBatch(batch, makeQueueEnv(), undefined, signer.factory)

    expect(signer.sentInputs).toHaveLength(1)
    const order = await readOrder(2)
    expect(order).toEqual({ status: "pending", execution_tx_hash: null })
    expect(ack).toHaveBeenCalledTimes(1)
    expect(retry).not.toHaveBeenCalled()
  })

  it("keeps the order pending without a queue retry on deterministic guard failures", async () => {
    const poolId = poolIdFor(3)
    await seedOrder(3, poolId)
    await primePrices(poolId)

    const signer = makeFakeSigner(new InsufficientKeeperBalanceError("0x", 0n, parseEther("0.05")))
    const { batch, ack, retry } = makeBatch(makeMessage({ orderId: 3, poolId }))

    await processQueueBatch(batch, makeQueueEnv(), undefined, signer.factory)

    const order = await readOrder(3)
    expect(order).toEqual({ status: "pending", execution_tx_hash: null })
    expect(ack).toHaveBeenCalledTimes(1)
    expect(retry).not.toHaveBeenCalled()
  })

  it("retries the queue message on transient RPC failures", async () => {
    const poolId = poolIdFor(4)
    await seedOrder(4, poolId)
    await primePrices(poolId)

    const signer = makeFakeSigner(new KeeperRpcError("rpc down"))
    const { batch, ack, retry } = makeBatch(makeMessage({ orderId: 4, poolId }))

    await processQueueBatch(batch, makeQueueEnv(), undefined, signer.factory)

    const order = await readOrder(4)
    expect(order).toEqual({ status: "pending", execution_tx_hash: null })
    expect(retry).toHaveBeenCalledTimes(1)
    expect(ack).not.toHaveBeenCalled()
  })

  it("stays evaluation-only when no TPSL address is configured", async () => {
    const poolId = poolIdFor(5)
    await seedOrder(5, poolId)
    await primePrices(poolId)

    const factory = vi.fn<KeeperSignerFactory>(() => {
      throw new Error("signer must not be created without a TPSL address")
    })
    const { batch, ack } = makeBatch(makeMessage({ orderId: 5, poolId }))

    await processQueueBatch(batch, makeQueueEnv({}), undefined, factory)

    expect(factory).not.toHaveBeenCalled()
    const order = await readOrder(5)
    expect(order).toEqual({ status: "pending", execution_tx_hash: null })
    expect(ack).toHaveBeenCalledTimes(1)
  })

  it("blocks execution when the order chain does not match the configured CHAIN_ID", async () => {
    const poolId = poolIdFor(6)
    await seedOrder(6, poolId)
    await primePrices(poolId)

    const factory = vi.fn<KeeperSignerFactory>(() => {
      throw new Error("signer must not be created on a chain mismatch")
    })
    const { batch, ack } = makeBatch(makeMessage({ orderId: 6, poolId }))

    await processQueueBatch(batch, makeQueueEnv({ TPSL_ADDRESS, CHAIN_ID: "1" }), undefined, factory)

    expect(factory).not.toHaveBeenCalled()
    const order = await readOrder(6)
    expect(order).toEqual({ status: "pending", execution_tx_hash: null })
    expect(ack).toHaveBeenCalledTimes(1)
  })

  it("marks expired orders and never invokes the signer", async () => {
    const poolId = poolIdFor(7)
    const past = Date.now() - 60_000
    await seedOrder(7, poolId, { deadline: past })
    await primePrices(poolId)

    const factory = vi.fn<KeeperSignerFactory>(() => {
      throw new Error("signer must not be created for an expired order")
    })
    const { batch, ack } = makeBatch(makeMessage({ orderId: 7, poolId, deadline: past }))

    await processQueueBatch(batch, makeQueueEnv(), undefined, factory)

    expect(factory).not.toHaveBeenCalled()
    const order = await readOrder(7)
    expect(order?.status).toBe("expired")
    expect(ack).toHaveBeenCalledTimes(1)
  })
})
