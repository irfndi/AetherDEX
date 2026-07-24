import { describe, expect, it } from "vitest"
import { buildLiquidityRequest, validateLiquidityForm, type LiquidityFormValues } from "../../src/lib/liquidity"

const validValues: LiquidityFormValues = {
  tokenSide: "token0",
  amount: "12.5",
  lowerTick: "-120",
  upperTick: "120",
  slippage: "0.5",
  deadline: "1800",
}

describe("liquidity form helpers", () => {
  it("accepts aligned ranges and bounded execution settings", () => {
    expect(validateLiquidityForm(validValues, 60)).toEqual({ valid: true, errors: {} })
  })

  it("reports range, amount, slippage, and deadline errors", () => {
    const result = validateLiquidityForm(
      { ...validValues, amount: "0", lowerTick: "-121", upperTick: "-180", slippage: "6", deadline: "30" },
      60,
    )

    expect(result.valid).toBe(false)
    expect(result.errors).toMatchObject({
      amount: "Enter an amount greater than zero.",
      lowerTick: "Use a multiple of 60.",
      upperTick: "Upper tick must be greater than lower tick.",
      slippage: "Use a value from 0% to 5%.",
      deadline: "Use a deadline between 1 minute and 24 hours.",
    })
  })

  it("builds an honest typed request without inventing a router address", () => {
    expect(buildLiquidityRequest("0xpool", validValues, 60)).toEqual({
      kind: "aetherdex.addLiquidity",
      poolId: "0xpool",
      tokenSide: "token0",
      amount: "12.5",
      lowerTick: -120,
      upperTick: 120,
      slippageBps: 50,
      deadlineSeconds: 1800,
      execution: { status: "not-configured", reason: "router-address-not-configured" },
    })
  })

  it("does not build a request for invalid input", () => {
    expect(buildLiquidityRequest("0xpool", { ...validValues, upperTick: "-180" }, 60)).toBeNull()
  })
})
