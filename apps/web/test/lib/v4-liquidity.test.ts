import { describe, expect, it } from "vitest"
import { buildV4SingleSidedCall, findV4SwapAmount, type V4SwapQuote } from "../../src/lib/v4-liquidity"

const pool = {
  chainId: 11155111,
  token0: "0x1111111111111111111111111111111111111111" as const,
  token1: "0x2222222222222222222222222222222222222222" as const,
  token0Decimals: 18,
  token1Decimals: 18,
  fee: 3000,
  tickSpacing: 60,
  hooks: "0x3333333333333333333333333333333333333333" as const,
  sqrtPriceX96: 79228162514264337593543950336n,
  liquidity: 1_000_000_000_000n,
  currentTick: 0,
} as const

describe("v4 liquidity adapter", () => {
  it("builds atomic single-sided router calldata with quote and liquidity bounds", () => {
    const call = buildV4SingleSidedCall({
      pool,
      tickLower: -600,
      tickUpper: 600,
      zeroForOne: true,
      amountIn: 1_000_000_000_000n,
      swapAmountIn: 400_000_000_000n,
      quotedAmountOut: 390_000_000_000n,
      minSwapAmountOut: 380_000_000_000n,
      slippageBps: 50,
      deadline: 2_000_000_000n,
    })

    expect(call.kind).toBe("v4-single-sided-zap")
    expect(call.calldata).toMatch(/^0x[0-9a-f]+$/)
    expect(call.liquidityDelta).toBeGreaterThan(0n)
    expect(call.expectedAmount0).toBeGreaterThan(0n)
    expect(call.expectedAmount1).toBeGreaterThan(0n)
  })

  it("rejects a quote that could spend more than the deposited token", () => {
    expect(() =>
      buildV4SingleSidedCall({
        pool,
        tickLower: -600,
        tickUpper: 600,
        zeroForOne: true,
        amountIn: 1n,
        swapAmountIn: 2n,
        quotedAmountOut: 1n,
        minSwapAmountOut: 1n,
        slippageBps: 50,
        deadline: 2_000_000_000n,
      }),
    ).toThrow("amounts are invalid")
  })
})

describe("findV4SwapAmount", () => {
  const oneToOneQuote = (amountIn: bigint): Promise<V4SwapQuote> =>
    Promise.resolve({ amountOut: amountIn, minAmountOut: amountIn })

  it("splits a deposit priced at parity into an even swap", async () => {
    const amountIn = 1_000_000n
    const result = await findV4SwapAmount({
      pool,
      tickLower: -600,
      tickUpper: 600,
      zeroForOne: true,
      amountIn,
      quote: oneToOneQuote,
    })

    expect(result.swapAmountIn).toBeGreaterThanOrEqual(1n)
    expect(result.swapAmountIn).toBeLessThan(amountIn)
    expect(result.swapAmountIn).toBeGreaterThan(amountIn / 4n)
    expect(result.swapAmountIn).toBeLessThan((amountIn * 3n) / 4n)
    expect(result.quote.amountOut).toBe(result.swapAmountIn)
  })

  it("swaps nearly the whole input when the target range only needs the output token", async () => {
    const amountIn = 1_000_000n
    const result = await findV4SwapAmount({
      pool,
      tickLower: -240,
      tickUpper: -60,
      zeroForOne: true,
      amountIn,
      quote: oneToOneQuote,
    })

    expect(result.swapAmountIn).toBeGreaterThanOrEqual(amountIn - 10_000n)
    expect(result.swapAmountIn).toBeLessThan(amountIn)
    expect(result.quote.amountOut).toBe(result.swapAmountIn)
  })

  it("handles the smallest splittable amount and rejects anything smaller", async () => {
    const result = await findV4SwapAmount({
      pool,
      tickLower: -600,
      tickUpper: 600,
      zeroForOne: true,
      amountIn: 3n,
      quote: oneToOneQuote,
    })
    expect(result.swapAmountIn).toBeGreaterThanOrEqual(1n)
    expect(result.swapAmountIn).toBeLessThanOrEqual(2n)

    await expect(
      findV4SwapAmount({
        pool,
        tickLower: -600,
        tickUpper: 600,
        zeroForOne: true,
        amountIn: 2n,
        quote: oneToOneQuote,
      }),
    ).rejects.toThrow("too small to split")
  })

  it("keeps the split bounded for a very large deposit on the other side", async () => {
    const amountIn = 10n ** 24n
    const result = await findV4SwapAmount({
      pool,
      tickLower: -600,
      tickUpper: 600,
      zeroForOne: false,
      amountIn,
      quote: oneToOneQuote,
    })

    expect(result.swapAmountIn).toBeGreaterThan(amountIn / 4n)
    expect(result.swapAmountIn).toBeLessThan((amountIn * 3n) / 4n)
    expect(result.quote.amountOut).toBe(result.swapAmountIn)
  })
})
