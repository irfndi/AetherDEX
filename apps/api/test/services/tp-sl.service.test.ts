/**
 * TP/SL order lifecycle — status-transition error semantics and keeper-record
 * idempotency against a stubbed SqlClient.
 */

import { Effect, Layer } from "effect"
import { SqlClient } from "effect/unstable/sql"
import { describe, expect, it } from "vitest"
import {
  OrderNotFoundError,
  OrderStateConflictError,
  TpSlService,
  TpSlServiceLive,
} from "../../src/services/tp-sl.service"

const CHAIN_ID = 11155111
const USER = "0x1111111111111111111111111111111111111111"
const TX_HASH = `0x${"cd".repeat(32)}`
const OTHER_TX_HASH = `0x${"ef".repeat(32)}`

const fakeSqlLayer = (handler: (query: string) => unknown) => {
  const fakeSql = ((...parts: ReadonlyArray<unknown>) => {
    const query = String(parts[0] ?? "")
    return Effect.succeed(handler(query))
  }) as unknown as SqlClient.SqlClient
  return Layer.succeed(SqlClient.SqlClient, fakeSql)
}

/** First cause reason of a failed exit: { _tag: "Fail", failure } or { _tag: "Die", defect }. */
const firstReason = (exit: { cause?: { reasons?: readonly unknown[] } }) =>
  (exit.cause?.reasons?.[0] ?? {}) as { _tag?: string; error?: unknown; defect?: unknown }

describe("TpSlService status transitions", () => {
  it("fails with OrderStateConflictError when cancelling an order that exists but is not pending", async () => {
    const layer = fakeSqlLayer((query) => {
      if (query.includes("UPDATE tp_sl_orders")) return { changes: 0 }
      if (query.includes("SELECT id FROM tp_sl_orders")) return [{ id: 1 }]
      return []
    })
    const exit = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* TpSlService
        return yield* svc.cancelOrder(1, USER, CHAIN_ID)
      }).pipe(Effect.provide(TpSlServiceLive.pipe(Layer.provide(layer))), Effect.exit),
    )
    expect(exit._tag).toBe("Failure")
    if (exit._tag !== "Failure") return
    expect(firstReason(exit)._tag).toBe("Fail")
    expect(firstReason(exit).error).toBeInstanceOf(OrderStateConflictError)
    expect(firstReason(exit).error).not.toBeInstanceOf(OrderNotFoundError)
  })

  it("fails with OrderNotFoundError when cancelling a missing order", async () => {
    const layer = fakeSqlLayer((query) => {
      if (query.includes("UPDATE tp_sl_orders")) return { changes: 0 }
      if (query.includes("SELECT id FROM tp_sl_orders")) return []
      return []
    })
    const exit = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* TpSlService
        return yield* svc.cancelOrder(1, USER, CHAIN_ID)
      }).pipe(Effect.provide(TpSlServiceLive.pipe(Layer.provide(layer))), Effect.exit),
    )
    expect(exit._tag).toBe("Failure")
    if (exit._tag !== "Failure") return
    expect(firstReason(exit)._tag).toBe("Fail")
    expect(firstReason(exit).error).toBeInstanceOf(OrderNotFoundError)
  })

  it("is idempotent when executeOrder retries with the same txHash on an already-executed order", async () => {
    const layer = fakeSqlLayer((query) => {
      if (query.includes("UPDATE tp_sl_orders")) return { changes: 0 }
      if (query.includes("execution_tx_hash FROM tp_sl_orders"))
        return [{ status: "executed", execution_tx_hash: TX_HASH }]
      return []
    })
    const exit = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* TpSlService
        return yield* svc.executeOrder(1, CHAIN_ID, TX_HASH, "1000")
      }).pipe(Effect.provide(TpSlServiceLive.pipe(Layer.provide(layer))), Effect.exit),
    )
    expect(exit._tag).toBe("Success")
  })

  it("fails with OrderStateConflictError when executeOrder retries with a different txHash", async () => {
    const layer = fakeSqlLayer((query) => {
      if (query.includes("UPDATE tp_sl_orders")) return { changes: 0 }
      if (query.includes("execution_tx_hash FROM tp_sl_orders"))
        return [{ status: "executed", execution_tx_hash: TX_HASH }]
      return []
    })
    const exit = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* TpSlService
        return yield* svc.executeOrder(1, CHAIN_ID, OTHER_TX_HASH, "1000")
      }).pipe(Effect.provide(TpSlServiceLive.pipe(Layer.provide(layer))), Effect.exit),
    )
    expect(exit._tag).toBe("Failure")
    if (exit._tag !== "Failure") return
    expect(firstReason(exit)._tag).toBe("Fail")
    expect(firstReason(exit).error).toBeInstanceOf(OrderStateConflictError)
  })

  it("does not duplicate keeper records on retry with the same txHash", async () => {
    const layer = fakeSqlLayer((query) => {
      if (query.includes("FROM keeper_executions")) return [{ id: 7 }]
      if (query.includes("INSERT INTO keeper_executions")) return [{ id: 99 }]
      return []
    })
    const id = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* TpSlService
        return yield* svc.recordKeeperExecution({
          orderId: 1,
          chainId: CHAIN_ID,
          keeperAddress: USER,
          txHash: TX_HASH,
          amountOut: "1000",
        })
      }).pipe(Effect.provide(TpSlServiceLive.pipe(Layer.provide(layer)))),
    )
    expect(id).toBe(7)
  })
})
