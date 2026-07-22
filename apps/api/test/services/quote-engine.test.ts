/**
 * Phase-0 G2 — V4 quote engine correctness.
 *
 * Expected outputs come from a closed-form oracle built on the canonical
 * Uniswap primitives (`TickMath`, `SwapMath.computeSwapStep`) — the same
 * low-level math, composed per-segment — so these tests prove the engine's
 * tick-crossing accumulation (the thing the legacy constant-product quote got
 * wrong), including exact hardcoded vectors for the fee-0 unit-price cases.
 */

import { SwapMath, TickMath } from "@uniswap/v3-sdk"
import JSBI from "jsbi"
import { describe, expect, it } from "vitest"
import {
  type InitializedTick,
  type PoolChainState,
  type PoolKeyParams,
  QuoteEngineError,
  simulateExactInputSwap,
  ZERO_HOOK_ADDRESS,
} from "../../src/services/quote-engine"

const Q96 = 2n ** 96n
const TOKEN_A = "0x0000000000000000000000000000000000000001"
const TOKEN_B = "0x0000000000000000000000000000000000000002"
const CHAIN_ID = 1

const keyOf = (fee: number): PoolKeyParams => ({
  token0: TOKEN_A,
  token1: TOKEN_B,
  fee,
  tickSpacing: 60,
  hooks: ZERO_HOOK_ADDRESS,
})

/** sqrtRatio at a tick, as bigint (from the canonical TickMath). */
const sqrtAt = (tick: number): bigint => BigInt(TickMath.getSqrtRatioAtTick(tick).toString())

/**
 * Oracle: exact-input swap composed per liquidity segment with
 * `SwapMath.computeSwapStep` (trusted Uniswap primitives). `segments` lists
 * successive (sqrtTarget, liquidity) pairs in swap direction.
 */
function oracleExactInput(
  s0: bigint,
  amountIn: bigint,
  fee: number,
  segments: ReadonlyArray<{ target: bigint; liquidity: bigint }>,
): bigint {
  let remaining = JSBI.BigInt(amountIn.toString())
  let current = JSBI.BigInt(s0.toString())
  let totalOut = 0n
  const feeJ = JSBI.BigInt(fee)
  for (const seg of segments) {
    if (JSBI.equal(remaining, JSBI.BigInt(0))) break
    const [sqrtQ, amountInSeg, amountOutSeg, feeAmountSeg] = SwapMath.computeSwapStep(
      current,
      JSBI.BigInt(seg.target.toString()),
      JSBI.BigInt(seg.liquidity.toString()),
      remaining,
      feeJ,
    )
    totalOut += BigInt(amountOutSeg.toString())
    remaining = JSBI.subtract(remaining, JSBI.add(amountInSeg, feeAmountSeg))
    current = sqrtQ
  }
  return totalOut
}

const MIN_TARGET = sqrtAt(TickMath.MIN_TICK + 60)

describe("simulateExactInputSwap — single-tick (no crossings)", () => {
  const state: PoolChainState = {
    sqrtPriceX96: Q96, // price 1.0 (tick 0)
    tick: 0,
    liquidity: 10n ** 18n,
    initializedTicks: [],
  }

  it("zeroForOne, fee 0, unit price: 1e18 in → exactly 5e17 out", async () => {
    const result = await simulateExactInputSwap({
      chainId: CHAIN_ID,
      key: keyOf(0),
      state,
      zeroForOne: true,
      amountIn: 10n ** 18n,
    })
    // Closed form: sqrtP' = Q96/2 → out = L·(Q96 − Q96/2)/Q96 = L/2
    expect(result.amountOut).toBe(500_000_000_000_000_000n)
    expect(result.crossedTicks).toBe(0)
    expect(result.liquidityAfter).toBe(10n ** 18n)
    expect(result.priceImpact).toBeCloseTo(0.5, 10)
  })

  it("oneForZero, fee 0, unit price: 1e18 in → exactly 5e17 out (symmetric)", async () => {
    const result = await simulateExactInputSwap({
      chainId: CHAIN_ID,
      key: keyOf(0),
      state,
      zeroForOne: false,
      amountIn: 10n ** 18n,
    })
    expect(result.amountOut).toBe(500_000_000_000_000_000n)
    expect(result.crossedTicks).toBe(0)
  })

  it("fee 3000 (0.3%): matches the per-step oracle exactly", async () => {
    const amountIn = 10n ** 18n
    const result = await simulateExactInputSwap({
      chainId: CHAIN_ID,
      key: keyOf(3000),
      state,
      zeroForOne: true,
      amountIn,
    })
    const expected = oracleExactInput(Q96, amountIn, 3000, [{ target: MIN_TARGET, liquidity: 10n ** 18n }])
    expect(result.amountOut).toBe(expected)
    expect(result.amountOut).toBe(499_248_873_309_964_947n) // exact expected output for this known case
  })
})

describe("simulateExactInputSwap — cross-tick (liquidityNet applied)", () => {
  // Positions: A=[-120, 60] L=5e17; C=[-360, -120] L=1e18; D=[-600, -360] L=1.5e18.
  // Active L at tick 0 = 5e17; below -120 → 1e18; below -360 → 1.5e18.
  // liquidityNet is the change when crossing a tick UPWARD, so the initialized
  // table carries: -600: +1.5e18, -360: -5e17, -120: -5e17, 60: -5e17 (sums to 0).
  const ticks: readonly InitializedTick[] = [
    { tick: -600, liquidityNet: 15n * 10n ** 17n, liquidityGross: 15n * 10n ** 17n },
    { tick: -360, liquidityNet: -(5n * 10n ** 17n), liquidityGross: 25n * 10n ** 17n },
    { tick: -120, liquidityNet: -(5n * 10n ** 17n), liquidityGross: 15n * 10n ** 17n },
    { tick: 60, liquidityNet: -(5n * 10n ** 17n), liquidityGross: 5n * 10n ** 17n },
  ]
  const state: PoolChainState = {
    sqrtPriceX96: sqrtAt(0),
    tick: 0,
    liquidity: 5n * 10n ** 17n,
    initializedTicks: ticks,
  }

  const S_120 = sqrtAt(-120)
  const S_360 = sqrtAt(-360)

  it("crosses exactly one tick (-120): exact oracle output, L becomes 1e18", async () => {
    // Large enough to pass -120, small enough to stop between -120 and -360.
    const amountIn = 8_000_000_000_000_000n
    const result = await simulateExactInputSwap({
      chainId: CHAIN_ID,
      key: keyOf(0),
      state,
      zeroForOne: true,
      amountIn,
    })

    const expected = oracleExactInput(state.sqrtPriceX96, amountIn, 0, [
      { target: S_120, liquidity: 5n * 10n ** 17n },
      { target: MIN_TARGET, liquidity: 10n ** 18n },
    ])
    expect(result.amountOut).toBe(expected)
    expect(result.amountOut).toBe(7_898_122_791_610_992n) // exact expected output for this known case
    expect(result.crossedTicks).toBe(1)
    expect(result.liquidityAfter).toBe(10n ** 18n) // liquidityNet applied at -120
    expect(result.tickAfter).toBe(-219)
    expect(result.priceImpact).toBeCloseTo(0.012734651048626033, 12)
    expect(result.sqrtPriceX96After).toBeLessThan(S_120)
  })

  it("crosses two ticks (-120, -360): exact oracle output, L becomes 1.5e18", async () => {
    const amountIn = 30_000_000_000_000_000n
    const result = await simulateExactInputSwap({
      chainId: CHAIN_ID,
      key: keyOf(0),
      state,
      zeroForOne: true,
      amountIn,
    })

    const expected = oracleExactInput(state.sqrtPriceX96, amountIn, 0, [
      { target: S_120, liquidity: 5n * 10n ** 17n },
      { target: S_360, liquidity: 10n ** 18n },
      { target: MIN_TARGET, liquidity: 15n * 10n ** 17n },
    ])
    expect(result.amountOut).toBe(expected)
    expect(result.amountOut).toBe(29_031_182_167_516_533n) // exact expected output for this known case
    expect(result.crossedTicks).toBe(2)
    expect(result.liquidityAfter).toBe(15n * 10n ** 17n)
    expect(result.tickAfter).toBe(-554)
  })

  it("cross-tick with fee 3000: exact oracle output across segments", async () => {
    const amountIn = 8_000_000_000_000_000n
    const result = await simulateExactInputSwap({
      chainId: CHAIN_ID,
      key: keyOf(3000),
      state,
      zeroForOne: true,
      amountIn,
    })
    const expected = oracleExactInput(state.sqrtPriceX96, amountIn, 3000, [
      { target: S_120, liquidity: 5n * 10n ** 17n },
      { target: MIN_TARGET, liquidity: 10n ** 18n },
    ])
    expect(result.amountOut).toBe(expected)
    expect(result.amountOut).toBe(7_874_642_060_126_690n) // exact expected output for this known case
    expect(result.crossedTicks).toBe(1)
  })

  it("a cross-tick quote differs from the constant-product approximation (the G2 fix)", async () => {
    // The legacy quote treated in-range liquidity as constant-product reserves;
    // the real CL math must yield a materially different output once a swap
    // consumes enough depth to cross the -120 tick and pick up liquidityNet.
    const amountIn = 8_000_000_000_000_000n
    const cl = await simulateExactInputSwap({
      chainId: CHAIN_ID,
      key: keyOf(0),
      state,
      zeroForOne: true,
      amountIn,
    })
    const cpReserve = 5n * 10n ** 17n
    const cpOut = (amountIn * cpReserve) / (cpReserve + amountIn) // fee-0 constant product
    expect(cl.amountOut).not.toBe(cpOut)
    expect(cl.crossedTicks).toBe(1)
  })
})

describe("simulateExactInputSwap — error cases", () => {
  it("rejects non-positive amountIn", async () => {
    await expect(
      simulateExactInputSwap({
        chainId: CHAIN_ID,
        key: keyOf(3000),
        state: { sqrtPriceX96: Q96, tick: 0, liquidity: 10n ** 18n, initializedTicks: [] },
        zeroForOne: true,
        amountIn: 0n,
      }),
    ).rejects.toMatchObject({ reason: "invalid_amount" })
  })

  it("rejects pools with no in-range liquidity", async () => {
    try {
      await simulateExactInputSwap({
        chainId: CHAIN_ID,
        key: keyOf(3000),
        state: { sqrtPriceX96: Q96, tick: 0, liquidity: 0n, initializedTicks: [] },
        zeroForOne: true,
        amountIn: 10n ** 18n,
      })
      expect.fail("expected QuoteEngineError")
    } catch (err) {
      expect(err).toBeInstanceOf(QuoteEngineError)
      expect((err as QuoteEngineError).reason).toBe("no_liquidity")
    }
  })
})
