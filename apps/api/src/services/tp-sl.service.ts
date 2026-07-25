/**
 * AetherDEX TP/SL Service — Phase 2
 *
 * Effect service for managing take-profit / stop-loss orders.
 * Handles CRUD operations, trigger evaluation, and order lifecycle.
 */

import { Context, Effect, Layer } from "effect"
import { SqlClient } from "effect/unstable/sql"

// ─── Types ──────────────────────────────────────────────────────────────────

export type OrderType = "take_profit" | "stop_loss"
export type OrderStatus = "pending" | "triggered" | "executed" | "cancelled" | "expired"

export interface TpSlOrder {
  readonly id: number
  readonly userAddress: string
  readonly poolId: string
  readonly orderType: OrderType
  readonly zeroForOne: boolean
  readonly amountIn: string
  readonly minAmountOut: string
  readonly triggerPriceX18: string
  readonly twapWindow: number
  readonly slippageBps: number
  readonly deadline: number
  readonly status: OrderStatus
  readonly createdAt: number
  readonly executedAt: number | null
  readonly executionTxHash: string | null
  readonly executionAmountOut: string | null
  readonly chainId: number
}

export interface CreateOrderInput {
  readonly userAddress: string
  readonly poolId: string
  readonly orderType: OrderType
  readonly zeroForOne: boolean
  readonly amountIn: string
  readonly minAmountOut: string
  readonly triggerPriceX18: string
  readonly twapWindow: number
  readonly slippageBps: number
  readonly deadline: number
  readonly chainId?: number
}

export interface TriggerCheckResult {
  readonly orderId: number
  readonly isTriggered: boolean
  readonly spotPriceX18: string | null
  readonly twapPriceX18: string | null
  readonly reason: string
}

// ─── Errors ─────────────────────────────────────────────────────────────────

export class OrderNotFoundError {
  readonly _tag = "OrderNotFoundError"
  constructor(readonly orderId: number) {}
}

export class OrderCreateError {
  readonly _tag = "OrderCreateError"
  constructor(readonly message: string) {}
}

export class OrderUpdateError {
  readonly _tag = "OrderUpdateError"
  constructor(readonly message: string) {}
}

export class TriggerCheckError {
  readonly _tag = "TriggerCheckError"
  constructor(readonly message: string) {}
}

export class OrderQueryError {
  readonly _tag = "OrderQueryError"
  constructor(readonly message: string) {}
}

// ─── Service interface ──────────────────────────────────────────────────────

export interface TpSlService {
  readonly createOrder: (input: CreateOrderInput) => Effect.Effect<number, OrderCreateError>
  readonly getOrder: (
    orderId: number,
    chainId: number,
  ) => Effect.Effect<TpSlOrder | null, OrderNotFoundError | OrderQueryError>
  readonly listByUser: (
    userAddress: string,
    chainId: number,
    limit?: number,
  ) => Effect.Effect<readonly TpSlOrder[], OrderQueryError>
  readonly listByPool: (
    poolId: string,
    chainId: number,
    status?: OrderStatus,
  ) => Effect.Effect<readonly TpSlOrder[], OrderQueryError>
  readonly listPendingByPool: (poolId: string, chainId: number) => Effect.Effect<readonly TpSlOrder[], OrderQueryError>
  readonly cancelOrder: (
    orderId: number,
    userAddress: string,
    chainId: number,
  ) => Effect.Effect<void, OrderNotFoundError | OrderUpdateError>
  readonly executeOrder: (
    orderId: number,
    chainId: number,
    txHash: string,
    amountOut: string,
  ) => Effect.Effect<void, OrderNotFoundError | OrderUpdateError>
  readonly expireOrder: (orderId: number, chainId: number) => Effect.Effect<void, OrderNotFoundError | OrderUpdateError>
  readonly getTriggerableOrders: (
    poolId: string,
    chainId: number,
  ) => Effect.Effect<readonly TpSlOrder[], OrderQueryError>
  readonly recordKeeperExecution: (input: {
    readonly orderId: number
    readonly keeperAddress: string
    readonly txHash: string
    readonly amountOut: string
    readonly gasUsed?: number
    readonly policyTriggered?: string
    readonly chainId: number
  }) => Effect.Effect<number, OrderCreateError>
}

// ─── Tag ────────────────────────────────────────────────────────────────────

export const TpSlService = Context.Service<TpSlService>("@aetherdex/TpSlService")

// ─── Row mapper ─────────────────────────────────────────────────────────────

function rowToOrder(row: Record<string, unknown>): TpSlOrder {
  return {
    id: row.id as number,
    userAddress: row.user_address as string,
    poolId: row.pool_id as string,
    orderType: row.order_type as OrderType,
    zeroForOne: Boolean(row.zero_for_one),
    amountIn: row.amount_in as string,
    minAmountOut: row.min_amount_out as string,
    triggerPriceX18: row.trigger_price_x18 as string,
    twapWindow: row.twap_window as number,
    slippageBps: row.slippage_bps as number,
    deadline: row.deadline as number,
    status: row.status as OrderStatus,
    createdAt: row.created_at as number,
    executedAt: (row.executed_at as number | null) ?? null,
    executionTxHash: (row.execution_tx_hash as string | null) ?? null,
    executionAmountOut: (row.execution_amount_out as string | null) ?? null,
    chainId: (row.chain_id as number) ?? 11155111,
  }
}

// ─── D1-backed implementation ───────────────────────────────────────────────

const makeTpSlService = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient

  const createOrder = (input: CreateOrderInput): Effect.Effect<number, OrderCreateError, never> =>
    Effect.gen(function* () {
      const now = Date.now()
      const chainId = input.chainId ?? 11155111

      const rows = (yield* sql`
        INSERT INTO tp_sl_orders
          (user_address, pool_id, order_type, zero_for_one, amount_in, min_amount_out,
           trigger_price_x18, twap_window, slippage_bps, deadline, status, created_at, chain_id)
        VALUES (${input.userAddress}, ${input.poolId}, ${input.orderType}, ${input.zeroForOne ? 1 : 0},
                ${input.amountIn}, ${input.minAmountOut}, ${input.triggerPriceX18}, ${input.twapWindow},
                ${input.slippageBps}, ${input.deadline}, 'pending', ${now}, ${chainId})
        RETURNING id
      `) as unknown as readonly Record<string, unknown>[]

      const id = rows[0]?.id
      if (typeof id !== "number") {
        return yield* Effect.fail(new OrderCreateError("INSERT INTO tp_sl_orders returned no id"))
      }
      return id
    }).pipe(
      Effect.catch((error) =>
        error instanceof OrderCreateError ? Effect.fail(error) : Effect.fail(new OrderCreateError(String(error))),
      ),
    )

  const getOrder = (
    orderId: number,
    chainId: number,
  ): Effect.Effect<TpSlOrder | null, OrderNotFoundError | OrderQueryError, never> =>
    Effect.gen(function* () {
      const row =
        (yield* sql`SELECT * FROM tp_sl_orders WHERE id = ${orderId} AND chain_id = ${chainId} LIMIT 1`) as unknown as readonly Record<
          string,
          unknown
        >[]
      if (row.length === 0) return null
      return rowToOrder(row[0])
    }).pipe(Effect.catch((error) => Effect.fail(new OrderQueryError(String(error)))))

  const listByUser = (
    userAddress: string,
    chainId: number,
    limit = 100,
  ): Effect.Effect<readonly TpSlOrder[], OrderQueryError, never> =>
    Effect.gen(function* () {
      const rows = (yield* sql`
        SELECT * FROM tp_sl_orders
        WHERE chain_id = ${chainId} AND user_address = ${userAddress}
        ORDER BY created_at DESC
        LIMIT ${limit}
      `) as unknown as readonly Record<string, unknown>[]
      return rows.map(rowToOrder)
    }).pipe(Effect.catch((error) => Effect.fail(new OrderQueryError(String(error)))))

  const listByPool = (
    poolId: string,
    chainId: number,
    status?: OrderStatus,
  ): Effect.Effect<readonly TpSlOrder[], OrderQueryError, never> =>
    Effect.gen(function* () {
      if (status) {
        const rows = (yield* sql`
          SELECT * FROM tp_sl_orders
          WHERE chain_id = ${chainId} AND pool_id = ${poolId} AND status = ${status}
          ORDER BY created_at DESC
        `) as unknown as readonly Record<string, unknown>[]
        return rows.map(rowToOrder)
      }
      const rows = (yield* sql`
        SELECT * FROM tp_sl_orders
        WHERE chain_id = ${chainId} AND pool_id = ${poolId}
        ORDER BY created_at DESC
      `) as unknown as readonly Record<string, unknown>[]
      return rows.map(rowToOrder)
    }).pipe(Effect.catch((error) => Effect.fail(new OrderQueryError(String(error)))))

  const listPendingByPool = (
    poolId: string,
    chainId: number,
  ): Effect.Effect<readonly TpSlOrder[], OrderQueryError, never> =>
    Effect.gen(function* () {
      const now = Date.now()
      const rows = (yield* sql`
        SELECT * FROM tp_sl_orders
        WHERE chain_id = ${chainId} AND pool_id = ${poolId} AND status = 'pending' AND deadline > ${now}
        ORDER BY created_at DESC
      `) as unknown as readonly Record<string, unknown>[]
      return rows.map(rowToOrder)
    }).pipe(Effect.catch((error) => Effect.fail(new OrderQueryError(String(error)))))

  const cancelOrder = (
    orderId: number,
    userAddress: string,
    chainId: number,
  ): Effect.Effect<void, OrderNotFoundError | OrderUpdateError, never> =>
    Effect.gen(function* () {
      const result = yield* sql`
        UPDATE tp_sl_orders
        SET status = 'cancelled'
        WHERE id = ${orderId} AND chain_id = ${chainId} AND user_address = ${userAddress} AND status = 'pending'
      ` as unknown as { changes: number }
      if ((result as { changes: number }).changes === 0) {
        return yield* Effect.fail(new OrderNotFoundError(orderId))
      }
    }).pipe(
      Effect.catch((error) =>
        error instanceof OrderNotFoundError ? Effect.fail(error) : Effect.fail(new OrderUpdateError(String(error))),
      ),
    )

  const executeOrder = (
    orderId: number,
    txHash: string,
    amountOut: string,
    chainId: number,
  ): Effect.Effect<void, OrderNotFoundError | OrderUpdateError, never> =>
    Effect.gen(function* () {
      const now = Date.now()
      const result = yield* sql`
        UPDATE tp_sl_orders
        SET status = 'executed', executed_at = ${now}, execution_tx_hash = ${txHash}, execution_amount_out = ${amountOut}
        WHERE id = ${orderId} AND chain_id = ${chainId} AND status = 'pending'
      ` as unknown as { changes: number }
      if ((result as { changes: number }).changes === 0) {
        return yield* Effect.fail(new OrderNotFoundError(orderId))
      }
    }).pipe(
      Effect.catch((error) =>
        error instanceof OrderNotFoundError ? Effect.fail(error) : Effect.fail(new OrderUpdateError(String(error))),
      ),
    )

  const expireOrder = (
    orderId: number,
    chainId: number,
  ): Effect.Effect<void, OrderNotFoundError | OrderUpdateError, never> =>
    Effect.gen(function* () {
      const result = yield* sql`
        UPDATE tp_sl_orders
        SET status = 'expired'
        WHERE id = ${orderId} AND chain_id = ${chainId} AND status = 'pending'
      ` as unknown as { changes: number }
      if ((result as { changes: number }).changes === 0) {
        return yield* Effect.fail(new OrderNotFoundError(orderId))
      }
    }).pipe(
      Effect.catch((error) =>
        error instanceof OrderNotFoundError ? Effect.fail(error) : Effect.fail(new OrderUpdateError(String(error))),
      ),
    )

  const getTriggerableOrders = (
    poolId: string,
    chainId: number,
  ): Effect.Effect<readonly TpSlOrder[], OrderQueryError, never> =>
    Effect.gen(function* () {
      const now = Date.now()
      const rows = (yield* sql`
        SELECT * FROM tp_sl_orders
        WHERE chain_id = ${chainId} AND pool_id = ${poolId} AND status = 'pending' AND deadline > ${now}
        ORDER BY created_at ASC
      `) as unknown as readonly Record<string, unknown>[]
      return rows.map(rowToOrder)
    }).pipe(Effect.catch((error) => Effect.fail(new OrderQueryError(String(error)))))

  const recordKeeperExecution = (input: {
    readonly orderId: number
    readonly keeperAddress: string
    readonly txHash: string
    readonly amountOut: string
    readonly gasUsed?: number
    readonly policyTriggered?: string
  }): Effect.Effect<number, OrderCreateError, never> =>
    Effect.gen(function* () {
      const now = Date.now()
      const rows = (yield* sql`
      INSERT INTO keeper_executions
          (order_id, chain_id, keeper_address, tx_hash, amount_out, gas_used, executed_at, policy_triggered)
        VALUES (${input.orderId}, ${input.chainId}, ${input.keeperAddress}, ${input.txHash}, ${input.amountOut},
                ${input.gasUsed ?? null}, ${now}, ${input.policyTriggered ?? null})
        RETURNING id
      `) as unknown as readonly Record<string, unknown>[]

      const id = rows[0]?.id
      if (typeof id !== "number") {
        return yield* Effect.fail(new OrderCreateError("INSERT INTO keeper_executions returned no id"))
      }
      return id
    }).pipe(
      Effect.catch((error) =>
        error instanceof OrderCreateError ? Effect.fail(error) : Effect.fail(new OrderCreateError(String(error))),
      ),
    )

  return {
    createOrder,
    getOrder,
    listByUser,
    listByPool,
    listPendingByPool,
    cancelOrder,
    executeOrder,
    expireOrder,
    getTriggerableOrders,
    recordKeeperExecution,
  }
})

// ─── Live layer ─────────────────────────────────────────────────────────────

export const TpSlServiceLive = Layer.effect(TpSlService, makeTpSlService)
