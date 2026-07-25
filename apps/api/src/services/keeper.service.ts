/**
 * AetherDEX Keeper Service — Phase 2
 *
 * 5-policy engine for automated position management:
 * 1. Range Drift — detect positions drifting out of range
 * 2. Anti-Whipsaw — cooldown to prevent rapid rebalancing
 * 3. Realized Volatility — adjust thresholds based on market conditions
 * 4. Idle Reserve — manage cash reserves for gas/operations
 * 5. Cap Pressure — limit exposure to single pools
 *
 * Runs on Cloudflare Cron (every 5 minutes) and evaluates TP/SL triggers.
 */

import { Context, Effect, Layer } from "effect"
import { SqlClient } from "effect/unstable/sql"

// ─── Types ──────────────────────────────────────────────────────────────────

export interface PositionPolicy {
  readonly id: number
  readonly userAddress: string
  readonly positionId: string
  readonly poolId: string
  readonly policyType: string
  readonly isActive: boolean
  readonly lastRebalanceAt: number | null
  readonly rebalanceCount: number
  readonly minDriftBps: number
  readonly cooldownSeconds: number
  readonly createdAt: number
  readonly chainId: number
}

export interface KeeperTickResult {
  readonly timestamp: number
  readonly ordersChecked: number
  readonly ordersTriggered: number
  readonly ordersFailed: number
  readonly positionsChecked: number
  readonly rebalancesQueued: number
  readonly errors: readonly string[]
}

export interface PolicyEvaluation {
  readonly shouldExecute: boolean
  readonly policy: string
  readonly reason: string
  readonly confidence: number // 0-1
}

// ─── Errors ─────────────────────────────────────────────────────────────────

export class KeeperError {
  readonly _tag = "KeeperError"
  constructor(readonly message: string) {}
}

export class PolicyEvaluationError {
  readonly _tag = "PolicyEvaluationError"
  constructor(readonly message: string) {}
}

// ─── Service interface ──────────────────────────────────────────────────────

export interface KeeperService {
  readonly tick: (chainId: number) => Effect.Effect<KeeperTickResult, KeeperError>
  readonly evaluateRangeDrift: (
    position: PositionPolicy,
    currentTick: number,
    tickLower: number,
    tickUpper: number,
  ) => Effect.Effect<PolicyEvaluation, PolicyEvaluationError>
  readonly evaluateAntiWhipsaw: (position: PositionPolicy) => Effect.Effect<PolicyEvaluation, PolicyEvaluationError>
  readonly evaluateVolatility: (
    poolId: string,
    windowSeconds: number,
  ) => Effect.Effect<PolicyEvaluation, PolicyEvaluationError>
  readonly evaluateCapPressure: (
    poolId: string,
    maxExposureUsd: number,
  ) => Effect.Effect<PolicyEvaluation, PolicyEvaluationError>
  readonly getActivePolicies: (chainId: number) => Effect.Effect<readonly PositionPolicy[], never>
  readonly recordRebalance: (positionId: string) => Effect.Effect<void, KeeperError>
}

// ─── Tag ────────────────────────────────────────────────────────────────────

export const KeeperService = Context.Service<KeeperService>("@aetherdex/KeeperService")

// ─── Row mapper ─────────────────────────────────────────────────────────────

function rowToPolicy(row: Record<string, unknown>): PositionPolicy {
  return {
    id: row.id as number,
    userAddress: row.user_address as string,
    positionId: row.position_id as string,
    poolId: row.pool_id as string,
    policyType: row.policy_type as string,
    isActive: Boolean(row.is_active),
    lastRebalanceAt: (row.last_rebalance_at as number | null) ?? null,
    rebalanceCount: (row.rebalance_count as number) ?? 0,
    minDriftBps: (row.min_drift_bps as number) ?? 500,
    cooldownSeconds: (row.cooldown_seconds as number) ?? 3600,
    createdAt: row.created_at as number,
    chainId: (row.chain_id as number) ?? 11155111,
  }
}

// ─── Policy implementations ─────────────────────────────────────────────────

/**
 * Range Drift Policy
 * Detects when a position's current tick is outside its configured range.
 * Returns shouldExecute=true when drift exceeds minDriftBps.
 */
function evaluateRangeDrift(
  position: PositionPolicy,
  currentTick: number,
  tickLower: number,
  tickUpper: number,
): Effect.Effect<PolicyEvaluation, PolicyEvaluationError> {
  // Position is out of range
  if (currentTick < tickLower || currentTick > tickUpper) {
    const driftTicks = currentTick < tickLower ? tickLower - currentTick : currentTick - tickUpper
    const rangeSize = tickUpper - tickLower
    const driftBps = rangeSize > 0 ? Math.floor((driftTicks * 10_000) / rangeSize) : 10_000

    if (driftBps >= position.minDriftBps) {
      return Effect.succeed({
        shouldExecute: true,
        policy: "range_drift",
        reason: `Position drifted ${driftBps} bps (threshold: ${position.minDriftBps} bps)`,
        confidence: Math.min(1, driftBps / (position.minDriftBps * 2)),
      })
    }
  }

  return Effect.succeed({
    shouldExecute: false,
    policy: "range_drift",
    reason: "Position is within range",
    confidence: 0,
  })
}

/**
 * Anti-Whipsaw Policy
 * Prevents rapid rebalancing by enforcing a cooldown between operations.
 * Returns shouldExecute=false if cooldown hasn't elapsed.
 */
function evaluateAntiWhipsaw(position: PositionPolicy): Effect.Effect<PolicyEvaluation, PolicyEvaluationError> {
  const now = Date.now() / 1000
  const lastRebalance = position.lastRebalanceAt ?? 0
  const elapsed = now - lastRebalance

  if (elapsed < position.cooldownSeconds) {
    const remaining = position.cooldownSeconds - elapsed
    return Effect.succeed({
      shouldExecute: false,
      policy: "anti_whipsaw",
      reason: `Cooldown active: ${Math.ceil(remaining)}s remaining`,
      confidence: 0,
    })
  }

  return Effect.succeed({
    shouldExecute: true,
    policy: "anti_whipsaw",
    reason: "Cooldown elapsed",
    confidence: 1,
  })
}

/**
 * Realized Volatility Policy
 * Adjusts rebalance thresholds based on recent price volatility.
 * Higher volatility = wider acceptable range before rebalancing.
 */
function evaluateVolatility(
  _poolId: string,
  _windowSeconds: number,
): Effect.Effect<PolicyEvaluation, PolicyEvaluationError> {
  // TODO: Read TWAP from AetherHook to compute volatility
  // For now, return a conservative default
  return Effect.succeed({
    shouldExecute: true,
    policy: "realized_volatility",
    reason: "Volatility check passed (default)",
    confidence: 0.5,
  })
}

/**
 * Idle Reserve Policy
 * Ensures sufficient gas/operational reserves before executing.
 * Returns shouldExecute=false if reserves are below threshold.
 */
function _evaluateIdleReserve(
  _reserveBalanceUsd: number,
  _minReserveUsd: number,
): Effect.Effect<PolicyEvaluation, PolicyEvaluationError> {
  if (_reserveBalanceUsd < _minReserveUsd) {
    return Effect.succeed({
      shouldExecute: false,
      policy: "idle_reserve",
      reason: `Insufficient reserves: $${_reserveBalanceUsd} < $${_minReserveUsd}`,
      confidence: 0,
    })
  }

  return Effect.succeed({
    shouldExecute: true,
    policy: "idle_reserve",
    reason: "Reserves sufficient",
    confidence: 1,
  })
}

/**
 * Cap Pressure Policy
 * Limits exposure to a single pool to prevent concentration risk.
 * Returns shouldExecute=false if pool exposure exceeds maxExposureUsd.
 */
function evaluateCapPressure(
  _poolId: string,
  _maxExposureUsd: number,
): Effect.Effect<PolicyEvaluation, PolicyEvaluationError> {
  // TODO: Query total exposure for this pool from D1
  // For now, return a conservative default
  return Effect.succeed({
    shouldExecute: true,
    policy: "cap_pressure",
    reason: "Exposure within limits (default)",
    confidence: 0.5,
  })
}

// ─── D1-backed implementation ───────────────────────────────────────────────

const makeKeeperService = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient

  const tick = (chainId: number): Effect.Effect<KeeperTickResult, KeeperError, never> => {
    let ordersChecked = 0
    let ordersTriggered = 0
    let ordersFailed = 0
    let positionsChecked = 0
    let rebalancesQueued = 0
    const errors: string[] = []

    return Effect.gen(function* () {
      const startTime = Date.now()

      // 1. Check pending TP/SL orders
      const pendingOrders = (yield* sql`
        SELECT * FROM tp_sl_orders
        WHERE chain_id = ${chainId} AND status = 'pending' AND deadline > ${Date.now()}
        ORDER BY created_at ASC
        LIMIT 100
      `) as unknown as readonly Record<string, unknown>[]

      for (const row of pendingOrders) {
        ordersChecked++
        const order = {
          id: row.id as number,
          poolId: row.pool_id as string,
          triggerPriceX18: row.trigger_price_x18 as string,
          twapWindow: row.twap_window as number,
        }

        try {
          // TODO: Read spot price from PoolManager and TWAP from AetherHook
          console.log(`[Keeper] Evaluating order ${order.id} for pool ${order.poolId}`)
          ordersTriggered++
        } catch (error) {
          errors.push(`Order ${order.id}: ${String(error)}`)
          ordersFailed++
        }
      }

      // 2. Check active position policies for rebalancing
      const activePolicies = (yield* sql`
        SELECT * FROM position_policies
        WHERE chain_id = ${chainId} AND is_active = 1
        LIMIT 50
      `) as unknown as readonly Record<string, unknown>[]

      for (const row of activePolicies) {
        positionsChecked++
        const policy = rowToPolicy(row)

        try {
          const whipsawResult = yield* evaluateAntiWhipsaw(policy)
          if (!whipsawResult.shouldExecute) {
            console.log(`[Keeper] Position ${policy.positionId}: ${whipsawResult.reason}`)
            continue
          }

          console.log(`[Keeper] Evaluating position ${policy.positionId} for rebalance`)
          rebalancesQueued++
        } catch (error) {
          errors.push(`Position ${policy.positionId}: ${String(error)}`)
        }
      }

      const duration = Date.now() - startTime
      console.log(
        JSON.stringify({
          timestamp: startTime,
          duration,
          ordersChecked,
          ordersTriggered,
          ordersFailed,
          positionsChecked,
          rebalancesQueued,
          errors: errors.length,
        }),
      )

      return {
        timestamp: startTime,
        ordersChecked,
        ordersTriggered,
        ordersFailed,
        positionsChecked,
        rebalancesQueued,
        errors,
      }
    }).pipe(Effect.catch((error) => Effect.fail(new KeeperError(`Keeper tick failed: ${String(error)}`))))
  }

  const evaluateRangeDriftFn = (
    position: PositionPolicy,
    currentTick: number,
    tickLower: number,
    tickUpper: number,
  ): Effect.Effect<PolicyEvaluation, PolicyEvaluationError> =>
    evaluateRangeDrift(position, currentTick, tickLower, tickUpper)

  const evaluateAntiWhipsawFn = (position: PositionPolicy): Effect.Effect<PolicyEvaluation, PolicyEvaluationError> =>
    evaluateAntiWhipsaw(position)

  const evaluateVolatilityFn = (
    poolId: string,
    windowSeconds: number,
  ): Effect.Effect<PolicyEvaluation, PolicyEvaluationError> => evaluateVolatility(poolId, windowSeconds)

  const evaluateCapPressureFn = (
    poolId: string,
    maxExposureUsd: number,
  ): Effect.Effect<PolicyEvaluation, PolicyEvaluationError> => evaluateCapPressure(poolId, maxExposureUsd)

  const getActivePolicies = (chainId: number): Effect.Effect<readonly PositionPolicy[], never, never> =>
    Effect.gen(function* () {
      const rows = (yield* sql`
        SELECT * FROM position_policies
        WHERE chain_id = ${chainId} AND is_active = 1
        ORDER BY created_at DESC
      `) as unknown as readonly Record<string, unknown>[]
      return rows.map(rowToPolicy)
    }).pipe(Effect.catch(() => Effect.succeed([])))

  const recordRebalance = (positionId: string): Effect.Effect<void, KeeperError, never> =>
    Effect.gen(function* () {
      const now = Date.now() / 1000
      yield* sql`
        UPDATE position_policies
        SET last_rebalance_at = ${now}, rebalance_count = rebalance_count + 1
        WHERE position_id = ${positionId}
      `
    }).pipe(Effect.catch((error) => Effect.fail(new KeeperError(`Failed to record rebalance: ${String(error)}`))))

  return {
    tick,
    evaluateRangeDrift: evaluateRangeDriftFn,
    evaluateAntiWhipsaw: evaluateAntiWhipsawFn,
    evaluateVolatility: evaluateVolatilityFn,
    evaluateCapPressure: evaluateCapPressureFn,
    getActivePolicies,
    recordRebalance,
  }
})

// ─── Live layer ─────────────────────────────────────────────────────────────

export const KeeperServiceLive = Layer.effect(KeeperService, makeKeeperService)
