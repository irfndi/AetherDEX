/**
 * AetherDEX Position Service — Phase 0 G3
 * Liquidity-position reads/writes as an Effect service (Context.Service +
 * Layer.effect + SqlClient), so /positions HTTP handlers never touch raw D1.
 */

import { Context, Effect, Layer } from "effect"
import { SqlClient } from "effect/unstable/sql"
import { listLiquidityEvents, updateLiquidityPosition, updateV4LiquidityPosition } from "../db/queries"
import { type LiquidityPosition, rowToLiquidityPosition } from "../db/schema"
import type { V3LiquidityEvent } from "./v3-liquidity-events"
import { reduceV3PositionEvents } from "./v3-position-reducer"
import type { V4PositionState } from "./v4-position-reader.service"

// --- Types ---

export interface RecordPositionInput {
  chainId?: number
  protocol?: "v3" | "v4"
  tokenId?: string
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
  readonly listByUser: (
    userAddress: string,
    limit?: number,
    chainId?: number,
  ) => Effect.Effect<LiquidityPosition[], PositionListError>
  readonly recordPosition: (input: RecordPositionInput) => Effect.Effect<number, RecordPositionError>
  readonly reconcileV3Position: (
    userAddress: string,
    tokenId: string,
    chainId: number,
  ) => Effect.Effect<LiquidityPosition | null, RecordPositionError>
  readonly reconcileV4Position: (
    userAddress: string,
    tokenId: string,
    chainId: number,
    state: V4PositionState,
  ) => Effect.Effect<number | null, RecordPositionError>
}

// --- Tag ---

export const PositionService = Context.Service<PositionService>("@aetherdex/PositionService")

// --- D1-backed implementation ---

const makePositionService = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient

  const listByUser = (
    userAddress: string,
    limit = 100,
    chainId = 1,
  ): Effect.Effect<LiquidityPosition[], PositionListError, never> =>
    Effect.gen(function* () {
      const rows = (yield* sql`
        SELECT liquidity_positions.*,
          pools.tick_spacing,
          pools.token0_address AS pool_token0_address,
          pools.token1_address AS pool_token1_address,
          pools.fee AS pool_fee,
          pools.hook_address AS pool_hook_address,
          pools.sqrt_price_x96 AS pool_sqrt_price_x96,
          pools.current_tick AS pool_current_tick,
          pools.liquidity AS pool_liquidity,
          token0.decimals AS pool_token0_decimals,
          token1.decimals AS pool_token1_decimals
        FROM liquidity_positions
        LEFT JOIN pools ON pools.chain_id = liquidity_positions.chain_id AND pools.pool_id = liquidity_positions.pool_id
        LEFT JOIN tokens token0 ON token0.chain_id = liquidity_positions.chain_id
          AND token0.address = pools.token0_address
        LEFT JOIN tokens token1 ON token1.chain_id = liquidity_positions.chain_id
          AND token1.address = pools.token1_address
        WHERE liquidity_positions.chain_id = ${chainId} AND user_address = ${userAddress} AND is_active = 1
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
          (chain_id, protocol, token_id, user_address, pool_id, tick_lower, tick_upper, liquidity, amount0, amount1,
           fees_earned_token0, fees_earned_token1, is_active, created_at, updated_at)
        VALUES (${input.chainId ?? 1}, ${input.protocol ?? "v4"}, ${input.tokenId ?? null}, ${input.userAddress}, ${input.poolId}, ${input.tickLower}, ${input.tickUpper}, ${input.liquidity}, ${input.amount0}, ${input.amount1}, '0', '0', 1, ${now}, ${now})
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

  const reconcileV3Position = (
    userAddress: string,
    tokenId: string,
    chainId: number,
  ): Effect.Effect<LiquidityPosition | null, RecordPositionError, never> =>
    Effect.gen(function* () {
      const events = yield* listLiquidityEvents(chainId, "v3", tokenId).pipe(
        Effect.provideService(SqlClient.SqlClient, sql),
      )
      const normalized: V3LiquidityEvent[] = events.map((event) => ({
        protocol: "v3",
        eventType: event.eventType,
        txHash: event.txHash as `0x${string}`,
        logIndex: event.logIndex,
        blockNumber: event.blockNumber,
        poolId: event.poolId,
        tokenId: event.tokenId,
        ownerAddress: event.ownerAddress as `0x${string}` | null,
        tickLower: event.tickLower,
        tickUpper: event.tickUpper,
        liquidityDelta: event.liquidityDelta,
        amount0: event.amount0,
        amount1: event.amount1,
      }))
      const state = reduceV3PositionEvents(normalized).get(tokenId)
      if (!state || state.ownerAddress?.toLowerCase() !== userAddress.toLowerCase()) return null
      const positionId = yield* updateLiquidityPosition({
        chainId,
        tokenId,
        ownerAddress: userAddress,
        liquidity: state.liquidity.toString(),
        amount0: state.amount0.toString(),
        amount1: state.amount1.toString(),
        fees0: state.fees0.toString(),
        fees1: state.fees1.toString(),
        costBasis0: state.costBasis0.toString(),
        costBasis1: state.costBasis1.toString(),
        isActive: state.isActive,
      }).pipe(Effect.provideService(SqlClient.SqlClient, sql))
      if (positionId === null) return null
      const rows = yield* sql`
        SELECT liquidity_positions.*, pools.tick_spacing
        FROM liquidity_positions LEFT JOIN pools ON pools.chain_id = liquidity_positions.chain_id AND pools.pool_id = liquidity_positions.pool_id
        WHERE liquidity_positions.id = ${positionId}
      `
      const row = rows[0]
      return row ? rowToLiquidityPosition(row as Record<string, unknown>) : null
    }).pipe(
      Effect.catch((error) =>
        error instanceof RecordPositionError ? Effect.fail(error) : Effect.fail(new RecordPositionError(String(error))),
      ),
    )

  const reconcileV4Position = (
    userAddress: string,
    tokenId: string,
    chainId: number,
    state: V4PositionState,
  ): Effect.Effect<number | null, RecordPositionError, never> =>
    state.owner.toLowerCase() !== userAddress.toLowerCase()
      ? Effect.succeed(null)
      : updateV4LiquidityPosition({
          chainId,
          tokenId,
          ownerAddress: userAddress,
          tickLower: state.tickLower,
          tickUpper: state.tickUpper,
          liquidity: state.liquidity.toString(),
        }).pipe(
          Effect.provideService(SqlClient.SqlClient, sql),
          Effect.catch((error) =>
            Effect.fail(error instanceof RecordPositionError ? error : new RecordPositionError(String(error))),
          ),
        )

  return {
    listByUser,
    recordPosition,
    reconcileV3Position,
    reconcileV4Position,
  }
})

// --- Live layer (requires SqlClient.SqlClient from D1) ---

export const PositionServiceLive = Layer.effect(PositionService, makePositionService)
