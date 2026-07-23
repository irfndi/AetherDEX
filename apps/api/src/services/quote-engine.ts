/**
 * AetherDEX V4 Quote Engine — Phase 0 G2
 *
 * Real Uniswap V4 concentrated-liquidity tick math, replacing the prior
 * constant-product approximation (which was wrong for CL: it ignored tick
 * crossings and `liquidityNet`).
 *
 * Simulates an exact-input swap over a snapshot of on-chain pool state
 * (`sqrtPriceX96` + current in-range liquidity + the initialized-tick table)
 * using the `@uniswap/v4-sdk` `Pool` (which steps the swap with the canonical
 * `TickMath` / `SwapMath`). Swaps that cross initialized ticks pick up each
 * position's `liquidityNet` exactly as the on-chain `PoolManager` does.
 *
 * The on-chain state read is abstracted behind `ChainStateReader`
 * (see `chain-state-reader.ts`) so the math is fully unit-testable with a
 * mock reader and no RPC / deployed contracts (those land in Phase 0 G5).
 */

import { type Currency, CurrencyAmount, Token } from "@uniswap/sdk-core"
import { Tick, type TickDataProvider, TickList } from "@uniswap/v3-sdk"
import { Pool } from "@uniswap/v4-sdk"

// ─── Types ──────────────────────────────────────────────────────────────────

/** V4 PoolKey — enough to identify a pool for state reads + calldata. */
export interface PoolKeyParams {
  readonly token0: string
  readonly token1: string
  readonly fee: number
  readonly tickSpacing: number
  /** Deployed hook address, or the zero address for hookless pools. */
  readonly hooks: string
}

/** An initialized tick as recorded on-chain (`StateView.getTickLiquidity`). */
export interface InitializedTick {
  readonly tick: number
  readonly liquidityNet: bigint
  readonly liquidityGross: bigint
}

/** On-chain pool state snapshot required to simulate a swap. */
export interface PoolChainState {
  readonly sqrtPriceX96: bigint
  readonly tick: number
  /** Current in-range liquidity (L at the active tick). */
  readonly liquidity: bigint
  /** Initialized ticks around the active price (from the quoter / StateView / indexer). */
  readonly initializedTicks: readonly InitializedTick[]
  /**
   * Inclusive [minTick, maxTick] range that `initializedTicks` was VERIFIED over.
   * When present, simulations whose terminal tick exits this window are rejected
   * (see `price_out_of_range`): outside the window, "no initialized tick found"
   * means "unverified", NOT "uninitialized", so continuing would quote a wrong
   * amount. Absent → the tick set is authoritative over the whole range
   * (full-table providers: Phase-3 indexer, unit-test mocks).
   */
  readonly verifiedTickWindow?: readonly [number, number]
}

export interface QuoteResult {
  /** Exact output amount (raw smallest units), fee already applied. */
  readonly amountOut: bigint
  /**
   * Price impact as a fraction 0..1: `1 - executionPrice / spotPrice`,
   * clamped at zero. Computed from raw amounts + the Q64.96 spot price so it
   * is token-decimals-independent.
   */
  readonly priceImpact: number
  /** Number of initialized ticks the swap crossed (liquidityNet applied). */
  readonly crossedTicks: number
  readonly tickAfter: number
  readonly sqrtPriceX96After: bigint
  readonly liquidityAfter: bigint
}

export class QuoteEngineError extends Error {
  readonly _tag = "QuoteEngineError"
  constructor(
    readonly reason: "invalid_amount" | "no_liquidity" | "simulation_failed" | "price_out_of_range",
    message: string,
  ) {
    super(message)
    this.name = "QuoteEngineError"
  }
}

/** Zero hook address — used to simulate pools whose hooks don't alter swap deltas. */
export const ZERO_HOOK_ADDRESS = "0x0000000000000000000000000000000000000000"

// ─── Tick data provider ─────────────────────────────────────────────────────

/**
 * In-memory `TickDataProvider` over a (possibly windowed) initialized-tick set.
 *
 * Unlike v3-sdk's `TickListDataProvider`, this does NOT require the tick
 * table's `liquidityNet` to sum to zero — the full universe of ticks is only
 * available from the Phase-3 indexer, while G2 reads a window around the
 * active price from `StateView.getTickLiquidity`. Ticks outside the known set
 * are treated as uninitialized (no liquidity change). The simulation rejects
 * (rather than approximates) any swap whose terminal tick leaves the state's
 * `verifiedTickWindow`, so this assumption is never applied to unverified
 * territory — see `simulateExactInputSwap`.
 */
class InMemoryTickDataProvider implements TickDataProvider {
  private readonly ticks: readonly Tick[]

  constructor(initialized: readonly InitializedTick[]) {
    this.ticks = [...initialized]
      .sort((a, b) => a.tick - b.tick)
      .map(
        (t) =>
          new Tick({
            index: t.tick,
            liquidityGross: t.liquidityGross.toString(),
            liquidityNet: t.liquidityNet.toString(),
          }),
      )
  }

  async getTick(tick: number): Promise<Tick> {
    const found = this.ticks.find((t) => t.index === tick)
    if (!found) {
      throw new Error(`Tick ${tick} is not initialized in the provided tick set`)
    }
    return found
  }

  async nextInitializedTickWithinOneWord(tick: number, lte: boolean, tickSpacing: number): Promise<[number, boolean]> {
    if (this.ticks.length === 0) {
      // No known initialized ticks: step to the boundary of the containing word.
      const wordSize = tickSpacing * 256
      const wordPos = Math.floor(tick / wordSize)
      const boundary = lte ? wordPos * wordSize : (wordPos + 1) * wordSize
      return [boundary, false]
    }
    return TickList.nextInitializedTickWithinOneWord(this.ticks as Tick[], tick, lte, tickSpacing)
  }
}

// ─── Engine ─────────────────────────────────────────────────────────────────

export interface SimulateExactInputParams {
  readonly chainId: number
  readonly key: PoolKeyParams
  readonly state: PoolChainState
  readonly zeroForOne: boolean
  readonly amountIn: bigint
}

/**
 * Build a V4 `Pool` for simulation from a chain-state snapshot.
 *
 * NOTE on hooks: `Pool.getOutputAmount` only simulates vanilla (hook-impact-free)
 * pools. The AetherDEX hook charges its protocol fee on LP actions, not on swap
 * deltas, so such pools quote identically to their vanilla equivalent — we
 * simulate with the zero hook address while keeping the deployed hook in the
 * `PoolKeyParams` for calldata. A hook that DOES alter swap deltas requires an
 * on-chain `Quoter` simulation instead (gated on G5 deployment).
 *
 * Token decimals do not affect raw-amount swap math; both currencies use 18 as
 * metadata-only decimals.
 */
export function buildSimulationPool(chainId: number, key: PoolKeyParams, state: PoolChainState): Pool {
  const token0 = new Token(chainId, key.token0, 18, "TOKEN0")
  const token1 = new Token(chainId, key.token1, 18, "TOKEN1")
  const provider = new InMemoryTickDataProvider(state.initializedTicks)
  return new Pool(
    token0,
    token1,
    key.fee,
    key.tickSpacing,
    ZERO_HOOK_ADDRESS,
    state.sqrtPriceX96.toString(),
    state.liquidity.toString(),
    state.tick,
    provider,
  )
}

/**
 * Simulate an exact-input swap against a pool-state snapshot.
 * Applies the pool fee internally (V4 `SwapMath` semantics) and steps across
 * initialized ticks using their recorded `liquidityNet`.
 */
export async function simulateExactInputSwap(params: SimulateExactInputParams): Promise<QuoteResult> {
  const { key, state, zeroForOne, amountIn } = params

  if (amountIn <= 0n) {
    throw new QuoteEngineError("invalid_amount", "amountIn must be a positive integer")
  }
  if (state.liquidity <= 0n) {
    throw new QuoteEngineError("no_liquidity", "Pool has no in-range liquidity")
  }

  let pool: Pool
  try {
    pool = buildSimulationPool(params.chainId, key, state)
  } catch (err) {
    throw new QuoteEngineError("simulation_failed", `Failed to build pool model: ${String(err)}`)
  }

  const inputToken = zeroForOne ? pool.currency0 : pool.currency1
  const input = CurrencyAmount.fromRawAmount(inputToken, amountIn.toString())

  let output: CurrencyAmount<Currency>
  let poolAfter: Pool
  try {
    ;[output, poolAfter] = await pool.getOutputAmount(input)
  } catch (err) {
    throw new QuoteEngineError("simulation_failed", `Swap simulation failed: ${String(err)}`)
  }

  const amountOut = BigInt(output.quotient.toString())

  // ── Price impact (raw-amount based, decimals-independent) ──
  // spot raw price (out per in): zeroForOne → (sqrtP² / 2^192), else (2^192 / sqrtP²)
  let priceImpact = 0
  if (amountOut > 0n) {
    const s2 = state.sqrtPriceX96 * state.sqrtPriceX96
    const two192 = 2n ** 192n
    const execRaw = Number(amountOut) / Number(amountIn)
    const midRaw = zeroForOne ? Number(s2) / Number(two192) : Number(two192) / Number(s2)
    if (Number.isFinite(midRaw) && midRaw > 0 && Number.isFinite(execRaw)) {
      priceImpact = Math.max(0, 1 - execRaw / midRaw)
    }
  }

  // ── Crossed initialized ticks ──
  const tickAfter = poolAfter.tickCurrent

  // The simulated price left the tick range the StateView snapshot verified: ticks
  // beyond it were never read, so the accumulated liquidityNet cannot be trusted in
  // EITHER direction. Reject rather than emit a non-conservative approximate quote.
  const window = state.verifiedTickWindow
  if (window && (tickAfter < window[0] || tickAfter > window[1])) {
    throw new QuoteEngineError(
      "price_out_of_range",
      `Swap exits the verified tick window [${window[0]}, ${window[1]}] (tickAfter ${tickAfter}) — retry with a smaller amount`,
    )
  }

  const crossed = state.initializedTicks.filter((t) =>
    zeroForOne ? t.tick <= state.tick && t.tick > tickAfter : t.tick > state.tick && t.tick <= tickAfter,
  ).length

  return {
    amountOut,
    priceImpact,
    crossedTicks: crossed,
    tickAfter,
    sqrtPriceX96After: BigInt(poolAfter.sqrtRatioX96.toString()),
    liquidityAfter: BigInt(poolAfter.liquidity.toString()),
  }
}
