import { describe, expect, it } from "vitest"
import { buildV4SingleSidedCall } from "../../src/lib/v4-liquidity"

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
  it("builds atomic single-sided PositionManager calldata with quote and liquidity bounds", () => {
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
      recipient: "0x4444444444444444444444444444444444444444",
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
        recipient: "0x4444444444444444444444444444444444444444",
      }),
    ).toThrow("amounts are invalid")
  })
})
