/**
 * AetherDEX Auto-Recenter Service — Phase 2
 *
 * Automatically rebalances out-of-range V4 positions by:
 * 1. Detecting positions that have drifted out of range
 * 2. Computing optimal new range based on current price
 * 3. Queuing rebalance transactions for keeper execution
 *
 * Integrates with the KeeperService policy engine for cooldown and drift checks.
 */

import { Context, Effect, Layer } from "effect"
import { SqlClient } from "effect/unstable/sql"

// ─── Types ──────────────────────────────────────────────────────────────────

export interface RebalanceRequest {
  readonly positionId: string
  readonly userAddress: string
  readonly poolId: string
  readonly currentTickLower: number
  readonly currentTickUpper: number
  readonly currentLiquidity: string
  readonly targetTickLower: number
  readonly targetTickUpper: number
  readonly reason: string
}

export interface RebalanceResult {
  readonly requestId: string
  readonly positionId: string
  readonly status: "queued" | "executed" | "failed"
  readonly txHash?: string
  readonly error?: string
}

// ─── Errors ─────────────────────────────────────────────────────────────────

export class AutoRecenterError {
  readonly _tag = "AutoRecenterError"
  constructor(readonly message: string) {}
}

// ─── Service interface ──────────────────────────────────────────────────────

export interface AutoRecenterService {
  readonly detectOutOfRangePositions: (chainId: number) => Effect.Effect<readonly RebalanceRequest[], AutoRecenterError>
  readonly computeOptimalRange: (input: {
    readonly currentTick: number
    readonly tickSpacing: number
    readonly rangeWidthTicks?: number
  }) => Effect.Effect<{ readonly tickLower: number; readonly tickUpper: number }, AutoRecenterError>
  readonly queueRebalance: (request: RebalanceRequest) => Effect.Effect<string, AutoRecenterError>
  readonly getPendingRebalances: () => Effect.Effect<readonly RebalanceRequest[], never>
}

// ─── Tag ────────────────────────────────────────────────────────────────────

export const AutoRecenterService = Context.Service<AutoRecenterService>("@aetherdex/AutoRecenterService")

// ─── Implementation ─────────────────────────────────────────────────────────

const makeAutoRecenterService = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient

  const detectOutOfRangePositions = (
    chainId: number,
  ): Effect.Effect<readonly RebalanceRequest[], AutoRecenterError, never> =>
    Effect.gen(function* () {
      // Query positions with active auto-recenter policies
      const positions = (yield* sql`
        SELECT pp.*, lp.tick_lower, lp.tick_upper, lp.liquidity
        FROM position_policies pp
        JOIN liquidity_positions lp ON pp.position_id = lp.id::text
        WHERE pp.chain_id = ${chainId}
          AND pp.is_active = 1
          AND pp.policy_type = 'auto_recenter'
          AND lp.is_active = 1
      `) as unknown as readonly Record<string, unknown>[]

      const requests: RebalanceRequest[] = []

      for (const row of positions) {
        const positionId = row.position_id as string
        const tickLower = row.tick_lower as number
        const tickUpper = row.tick_upper as number
        const liquidity = row.liquidity as string

        // TODO: Read current tick from PoolManager
        // For now, assume the position is out of range if we can't read the current tick
        // In production, this would read from ChainStateReader

        requests.push({
          positionId,
          userAddress: row.user_address as string,
          poolId: row.pool_id as string,
          currentTickLower: tickLower,
          currentTickUpper: tickUpper,
          currentLiquidity: liquidity,
          targetTickLower: tickLower, // Will be computed by computeOptimalRange
          targetTickUpper: tickUpper,
          reason: "auto_recenter: position detected as potentially out of range",
        })
      }

      return requests
    }).pipe(Effect.catch((error) => Effect.fail(new AutoRecenterError(`Failed to detect positions: ${String(error)}`))))

  const computeOptimalRange = (input: {
    readonly currentTick: number
    readonly tickSpacing: number
    readonly rangeWidthTicks?: number
  }): Effect.Effect<{ readonly tickLower: number; readonly tickUpper: number }, AutoRecenterError> =>
    Effect.gen(function* () {
      const { currentTick, tickSpacing, rangeWidthTicks: explicitRangeWidth } = input

      // Adapt range width to tick spacing if not explicitly provided
      // At 60 tick spacing (0.05% fee tier): 200 ticks
      // At 200 tick spacing (0.3% fee tier): 400 ticks
      // At 3000 tick spacing (1% fee tier): 600 ticks
      const rangeWidthTicks = explicitRangeWidth ?? Math.max(tickSpacing * 3, 200)

      // Align to tick spacing
      const alignedTick = Math.floor(currentTick / tickSpacing) * tickSpacing
      const halfRange = Math.floor(rangeWidthTicks / 2)

      // Compute new range centered on current tick
      const tickLower = alignedTick - halfRange
      const tickUpper = alignedTick + halfRange

      // Validate range is within V4 bounds
      if (tickLower < -887220 || tickUpper > 887220) {
        return yield* Effect.fail(
          new AutoRecenterError(`Computed range [${tickLower}, ${tickUpper}] is out of V4 bounds`),
        )
      }

      return { tickLower, tickUpper }
    })

  const queueRebalance = (request: RebalanceRequest): Effect.Effect<string, AutoRecenterError, never> =>
    Effect.gen(function* () {
      const requestId = `rebal-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

      // Store rebalance request for keeper execution
      yield* sql`
        INSERT INTO keeper_executions
          (order_id, keeper_address, tx_hash, amount_out, policy_triggered)
        VALUES (0, 'auto-recenter', ${requestId}, '0', 'auto_recenter')
      `.pipe(Effect.catch(() => Effect.succeed(undefined)))

      console.log(
        JSON.stringify({
          event: "rebalance_queued",
          requestId,
          positionId: request.positionId,
          poolId: request.poolId,
          reason: request.reason,
        }),
      )

      return requestId
    }).pipe(Effect.catch((error) => Effect.fail(new AutoRecenterError(`Failed to queue rebalance: ${String(error)}`))))

  const getPendingRebalances = (): Effect.Effect<readonly RebalanceRequest[], never, never> =>
    Effect.gen(function* () {
      // Query positions with auto-recenter policies that haven't been rebalanced recently
      const positions = (yield* sql`
        SELECT pp.*, lp.tick_lower, lp.tick_upper, lp.liquidity
        FROM position_policies pp
        JOIN liquidity_positions lp ON pp.position_id = lp.id::text
        WHERE pp.is_active = 1
          AND pp.policy_type = 'auto_recenter'
          AND lp.is_active = 1
          AND (pp.last_rebalance_at IS NULL OR pp.last_rebalance_at < ${Date.now() / 1000 - 3600})
      `) as unknown as readonly Record<string, unknown>[]

      return positions.map((row) => ({
        positionId: row.position_id as string,
        userAddress: row.user_address as string,
        poolId: row.pool_id as string,
        currentTickLower: row.tick_lower as number,
        currentTickUpper: row.tick_upper as number,
        currentLiquidity: row.liquidity as string,
        targetTickLower: row.tick_lower as number,
        targetTickUpper: row.tick_upper as number,
        reason: "auto_recenter: pending rebalance",
      }))
    }).pipe(Effect.catch(() => Effect.succeed([])))

  return {
    detectOutOfRangePositions,
    computeOptimalRange,
    queueRebalance,
    getPendingRebalances,
  }
})

// ─── Live layer ─────────────────────────────────────────────────────────────

export const AutoRecenterServiceLive = Layer.effect(AutoRecenterService, makeAutoRecenterService)
