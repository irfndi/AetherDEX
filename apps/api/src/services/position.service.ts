/**
 * AetherDEX Position Service — Phase 0 G3
 * Liquidity-position reads/writes as an Effect service (Context.Service +
 * Layer.effect + SqlClient), so /positions HTTP handlers never touch raw D1.
 */

import { Context, Effect, Layer } from "effect"
import { SqlClient } from "effect/unstable/sql"
import { type LiquidityPosition, rowToLiquidityPosition } from "../db/schema"

// --- Types ---

export interface RecordPositionInput {
  userAddress: string
  poolId: string
  tickLower: number
  tickUpper: number
  liquidity: string
  amount0: string
  amount1: string
}

// --- Errors ---

export class PositionListError {
  readonly _tag = "PositionListError"
  constructor(readonly cause: string) {}
}

export class RecordPositionError {
  readonly _tag = "RecordPositionError"
  constructor(readonly message: string) {}
}

// --- Service interface ---

export interface PositionService {
  readonly listByUser: (userAddress: string, limit?: number) => Effect.Effect<LiquidityPosition[], PositionListError>
  readonly recordPosition: (input: RecordPositionInput) => Effect.Effect<number, RecordPositionError>
}

// --- Tag ---

export const PositionService = Context.Service<PositionService>("@aetherdex/PositionService")

// --- D1-backed implementation ---

const makePositionService = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient

  const listByUser = (userAddress: string, limit = 100): Effect.Effect<LiquidityPosition[], PositionListError, never> =>
    Effect.gen(function* () {
      const rows = (yield* sql`
        SELECT * FROM liquidity_positions
        WHERE user_address = ${userAddress} AND is_active = 1
        ORDER BY created_at DESC
        LIMIT ${limit}
      `) as unknown as readonly Record<string, unknown>[]
      return rows.map((r: Record<string, unknown>) => rowToLiquidityPosition(r))
    }).pipe(Effect.catch((error) => Effect.fail(new PositionListError(String(error)))))

  const recordPosition = (input: RecordPositionInput): Effect.Effect<number, RecordPositionError, never> =>
    Effect.gen(function* () {
      const now = Date.now()
      const rows = (yield* sql`
        INSERT INTO liquidity_positions
          (user_address, pool_id, tick_lower, tick_upper, liquidity, amount0, amount1,
           fees_earned_token0, fees_earned_token1, is_active, created_at, updated_at)
        VALUES (${input.userAddress}, ${input.poolId}, ${input.tickLower}, ${input.tickUpper}, ${input.liquidity}, ${input.amount0}, ${input.amount1}, '0', '0', 1, ${now}, ${now})
        RETURNING id
      `) as unknown as readonly Record<string, unknown>[]
      const id = rows[0]?.id
      if (typeof id !== "number") {
        return yield* Effect.fail(
          new RecordPositionError("INSERT INTO liquidity_positions returned no id — insert failed"),
        )
      }
      return id
    }).pipe(
      Effect.catch((error) =>
        error instanceof RecordPositionError ? Effect.fail(error) : Effect.fail(new RecordPositionError(String(error))),
      ),
    )

  return {
    listByUser,
    recordPosition,
  }
})

// --- Live layer (requires SqlClient.SqlClient from D1) ---

export const PositionServiceLive = Layer.effect(PositionService, makePositionService)
