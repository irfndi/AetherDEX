/**
 * AetherDEX On-Chain Verification Gate — Phase 2
 *
 * Before any fund-moving action, the keeper reconciles position state
 * on-chain via ChainStateReader. It never trusts client-supplied D1 data.
 *
 * This service wraps the ChainStateReader with verification-specific logic:
 * - Position range validation
 * - Liquidity verification
 * - Price sanity checks
 * - TWAP staleness detection
 */

import { Context, Effect, Layer } from "effect"
import { ChainStateReader } from "./chain-state-reader"
import { MAX_TICK, MIN_TICK } from "./tick-bounds"

// ─── Types ──────────────────────────────────────────────────────────────────

export interface PositionVerification {
  readonly isValid: boolean
  readonly poolId: string
  readonly currentTick: number
  readonly sqrtPriceX96: bigint
  readonly liquidity: bigint
  readonly tickLower: number
  readonly tickUpper: number
  readonly isInRange: boolean
  readonly driftBps: number
  readonly errors: readonly string[]
}

export interface TriggerVerification {
  readonly isTriggered: boolean
  readonly spotPriceX18: bigint
  readonly twapPriceX18: bigint | null
  readonly triggerPriceX18: bigint
  readonly orderType: "take_profit" | "stop_loss"
  readonly zeroForOne: boolean
  readonly dualTriggerMet: boolean
  readonly errors: readonly string[]
}

export interface PoolKeyParams {
  readonly token0: string
  readonly token1: string
  readonly fee: number
  readonly tickSpacing: number
  readonly hooks: string
}

// ─── Errors ─────────────────────────────────────────────────────────────────

export class VerificationError {
  readonly _tag = "VerificationError"
  constructor(
    readonly reason: string,
    readonly details?: string,
  ) {}
}

// ─── Service interface ──────────────────────────────────────────────────────

export interface VerificationService {
  readonly verifyPosition: (input: {
    readonly poolKey: PoolKeyParams
    readonly tickLower: number
    readonly tickUpper: number
    readonly expectedLiquidity?: bigint
  }) => Effect.Effect<PositionVerification, VerificationError>

  readonly verifyTrigger: (input: {
    readonly poolKey: PoolKeyParams
    readonly twapWindow: number
    readonly triggerPriceX18: bigint
    readonly orderType: "take_profit" | "stop_loss"
    readonly zeroForOne: boolean
  }) => Effect.Effect<TriggerVerification, VerificationError>

  readonly verifySufficientLiquidity: (input: {
    readonly poolKey: PoolKeyParams
    readonly minimumLiquidity: bigint
  }) => Effect.Effect<boolean, VerificationError>
}

// ─── Tag ────────────────────────────────────────────────────────────────────

export const VerificationService = Context.Service<VerificationService>("@aetherdex/VerificationService")

const readPoolState = (reader: ChainStateReader, poolKey: PoolKeyParams) =>
  reader
    .getPoolState(poolKey)
    .pipe(
      Effect.catch((error) =>
        Effect.fail(
          error._tag === "OnChainReadError"
            ? new VerificationError("pool_read_failed", error.message)
            : new VerificationError("unknown", String(error)),
        ),
      ),
    )

// ─── Implementation ─────────────────────────────────────────────────────────

const makeVerificationService = Effect.gen(function* () {
  const chainStateReader = yield* ChainStateReader

  const verifyPosition = (input: {
    readonly poolKey: PoolKeyParams
    readonly tickLower: number
    readonly tickUpper: number
    readonly expectedLiquidity?: bigint
  }): Effect.Effect<PositionVerification, VerificationError> =>
    Effect.gen(function* () {
      const errors: string[] = []

      const state = yield* readPoolState(chainStateReader, input.poolKey)

      const currentTick = state.tick
      const isInRange = currentTick >= input.tickLower && currentTick <= input.tickUpper

      // Calculate drift from range center
      const rangeSize = input.tickUpper - input.tickLower
      const driftTicks =
        currentTick < input.tickLower
          ? input.tickLower - currentTick
          : currentTick > input.tickUpper
            ? currentTick - input.tickUpper
            : 0
      const driftBps = rangeSize > 0 ? Math.floor((driftTicks * 10_000) / rangeSize) : 0

      // Validate liquidity if expected
      if (input.expectedLiquidity !== undefined) {
        if (state.liquidity < input.expectedLiquidity) {
          errors.push(`Liquidity mismatch: on-chain ${state.liquidity} < expected ${input.expectedLiquidity}`)
        }
      }

      // Validate tick range is valid
      if (input.tickLower >= input.tickUpper) {
        errors.push("Invalid tick range: tickLower >= tickUpper")
      }

      // Validate current tick is within reasonable bounds
      if (currentTick < MIN_TICK || currentTick > MAX_TICK) {
        errors.push("Current tick outside V4 bounds")
      }

      return {
        isValid: errors.length === 0,
        poolId: `${input.poolKey.token0.toLowerCase()}-${input.poolKey.token1.toLowerCase()}-${input.poolKey.fee}-${input.poolKey.tickSpacing}-${input.poolKey.hooks.toLowerCase()}`,
        currentTick,
        sqrtPriceX96: state.sqrtPriceX96,
        liquidity: state.liquidity,
        tickLower: input.tickLower,
        tickUpper: input.tickUpper,
        isInRange,
        driftBps,
        errors,
      }
    }).pipe(
      Effect.catch((error) => {
        if (error instanceof VerificationError) {
          return Effect.fail(error)
        }
        return Effect.fail(new VerificationError("verification_failed", String(error)))
      }),
    )

  const verifyTrigger = (input: {
    readonly poolKey: PoolKeyParams
    readonly twapWindow: number
    readonly triggerPriceX18: bigint
    readonly orderType: "take_profit" | "stop_loss"
    readonly zeroForOne: boolean
  }): Effect.Effect<TriggerVerification, VerificationError> =>
    Effect.gen(function* () {
      const errors: string[] = []

      // Read current pool state
      const state = yield* readPoolState(chainStateReader, input.poolKey)

      // Compute spot price from sqrtPriceX96
      // priceX18 = (sqrtPriceX96^2 / 2^96) * 1e18 / 2^96
      const sqrtP = state.sqrtPriceX96
      const priceX96 = (sqrtP * sqrtP) / 2n ** 96n
      const spotPriceX18 = (priceX96 * 10n ** 18n) / 2n ** 96n

      // TODO: Read TWAP from AetherHook contract
      // For now, use spot price as TWAP placeholder
      const twapPriceX18: bigint | null = null
      errors.push("TWAP unavailable until Phase-0 G2.5 is deployed")

      // Evaluate trigger condition
      let isTriggered = false
      let dualTriggerMet = false

      if (input.orderType === "take_profit") {
        if (input.zeroForOne) {
          // TP: price must go DOWN (selling token0 for token1)
          isTriggered = spotPriceX18 <= input.triggerPriceX18
          dualTriggerMet = isTriggered && twapPriceX18 !== null && twapPriceX18 <= input.triggerPriceX18
        } else {
          // TP: price must go UP (selling token1 for token0)
          isTriggered = spotPriceX18 >= input.triggerPriceX18
          dualTriggerMet = isTriggered && twapPriceX18 !== null && twapPriceX18 >= input.triggerPriceX18
        }
      } else {
        // STOP_LOSS
        if (input.zeroForOne) {
          // SL: price must go UP (selling token0 for token1)
          isTriggered = spotPriceX18 >= input.triggerPriceX18
          dualTriggerMet = isTriggered && twapPriceX18 !== null && twapPriceX18 >= input.triggerPriceX18
        } else {
          // SL: price must go DOWN (selling token1 for token0)
          isTriggered = spotPriceX18 <= input.triggerPriceX18
          dualTriggerMet = isTriggered && twapPriceX18 !== null && twapPriceX18 <= input.triggerPriceX18
        }
      }

      // Sanity checks
      if (spotPriceX18 === 0n) {
        errors.push("Spot price is zero - pool may be uninitialized")
      }

      return {
        isTriggered: dualTriggerMet, // Require both spot and TWAP
        spotPriceX18,
        twapPriceX18,
        triggerPriceX18: input.triggerPriceX18,
        orderType: input.orderType,
        zeroForOne: input.zeroForOne,
        dualTriggerMet,
        errors,
      }
    }).pipe(
      Effect.catch((error) => {
        if (error instanceof VerificationError) {
          return Effect.fail(error)
        }
        return Effect.fail(new VerificationError("trigger_verification_failed", String(error)))
      }),
    )

  const verifySufficientLiquidity = (input: {
    readonly poolKey: PoolKeyParams
    readonly minimumLiquidity: bigint
  }): Effect.Effect<boolean, VerificationError> =>
    Effect.gen(function* () {
      const state = yield* readPoolState(chainStateReader, input.poolKey)

      return state.liquidity >= input.minimumLiquidity
    })

  return {
    verifyPosition,
    verifyTrigger,
    verifySufficientLiquidity,
  }
})

// ─── Live layer ─────────────────────────────────────────────────────────────

export const VerificationServiceLive = Layer.effect(VerificationService, makeVerificationService)
