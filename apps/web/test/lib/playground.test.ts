import { describe, expect, it } from "vitest"
import {
  allocatePositionAmounts,
  type AllocationResult,
  priceFromSqrtPriceX96,
  type ScenarioResult,
  simulatePriceScenarios,
  validatePlaygroundRange,
} from "../../src/lib/playground"

const assertAllocationOk = (result: AllocationResult) => {
  if (!result.ok) throw new Error(`Expected ok allocation, got errors: ${JSON.stringify(result.errors)}`)
  return result
}

const assertScenarioOk = (result: ScenarioResult) => {
  if (!result.ok) throw new Error(`Expected ok scenarios, got errors: ${JSON.stringify(result.errors)}`)
  return result
}

describe("validatePlaygroundRange", () => {
  it("accepts a well-formed range", () => {
    expect(validatePlaygroundRange({ currentPrice: 2000, lowerPrice: 1500, upperPrice: 2500 })).toEqual({
      valid: true,
      errors: {},
    })
  })

  it("rejects non-positive prices and inverted ranges", () => {
    const result = validatePlaygroundRange({ currentPrice: 0, lowerPrice: -5, upperPrice: 10 })

    expect(result.valid).toBe(false)
    expect(result.errors.currentPrice).toBe("Enter a price greater than zero.")
    expect(result.errors.lowerPrice).toBe("Enter a price greater than zero.")
    expect(result.errors.upperPrice).toBeUndefined()
  })

  it("rejects an upper price that does not exceed the lower price", () => {
    const result = validatePlaygroundRange({ currentPrice: 100, lowerPrice: 200, upperPrice: 200 })

    expect(result.valid).toBe(false)
    expect(result.errors.upperPrice).toBe("Upper price must be greater than lower price.")
  })

  it("rejects NaN prices", () => {
    const result = validatePlaygroundRange({ currentPrice: Number.NaN, lowerPrice: 1, upperPrice: 2 })

    expect(result.valid).toBe(false)
    expect(result.errors.currentPrice).toBe("Enter a price greater than zero.")
  })
})

describe("allocatePositionAmounts", () => {
  it("allocates the whole budget to token0 below the range", () => {
    const result = assertAllocationOk(
      allocatePositionAmounts({ amountUsdOrToken: 1000, currentPrice: 1000, lowerPrice: 1500, upperPrice: 2500 }),
    )

    expect(result.side).toBe("below")
    expect(result.amount0).toBeCloseTo(1, 10) // 1000 USD at 1000 USD/token0
    expect(result.amount1).toBe(0)
    expect(result.value0Usd).toBe(1000)
    expect(result.value1Usd).toBe(0)
    expect(result.token0Share).toBe(1)
  })

  it("allocates the whole budget to token0 at exactly the lower bound", () => {
    const result = assertAllocationOk(
      allocatePositionAmounts({ amountUsdOrToken: 500, currentPrice: 1500, lowerPrice: 1500, upperPrice: 2500 }),
    )

    expect(result.side).toBe("below")
    expect(result.token0Share).toBe(1)
    expect(result.amount1).toBe(0)
  })

  it("allocates the whole budget to token1 above the range", () => {
    const result = assertAllocationOk(
      allocatePositionAmounts({ amountUsdOrToken: 1000, currentPrice: 3000, lowerPrice: 1500, upperPrice: 2500 }),
    )

    expect(result.side).toBe("above")
    expect(result.amount0).toBe(0)
    expect(result.amount1).toBe(1000)
    expect(result.value1Usd).toBe(1000)
    expect(result.token0Share).toBe(0)
  })

  it("splits the budget inside the range and is continuous with the boundaries", () => {
    const inside = assertAllocationOk(
      allocatePositionAmounts({ amountUsdOrToken: 1000, currentPrice: 2000, lowerPrice: 1500, upperPrice: 2500 }),
    )

    expect(inside.side).toBe("inside")
    expect(inside.token0Share).toBeGreaterThan(0)
    expect(inside.token0Share).toBeLessThan(1)
    // Entry value of both legs adds back up to the budget.
    expect(inside.value0Usd + inside.value1Usd).toBeCloseTo(1000, 8)
    expect(inside.totalValueUsd).toBe(1000)
    // Token amounts re-value back to their legs at the current price.
    expect(inside.amount0 * 2000).toBeCloseTo(inside.value0Usd, 8)
    expect(inside.amount1).toBeCloseTo(inside.value1Usd, 8)
  })

  it("holds more token1 value nearer the upper bound and more token0 value nearer the lower bound", () => {
    const nearLower = assertAllocationOk(
      allocatePositionAmounts({ amountUsdOrToken: 1000, currentPrice: 1510, lowerPrice: 1500, upperPrice: 2500 }),
    )
    const nearUpper = assertAllocationOk(
      allocatePositionAmounts({ amountUsdOrToken: 1000, currentPrice: 2490, lowerPrice: 1500, upperPrice: 2500 }),
    )

    expect(nearLower.token0Share).toBeGreaterThan(0.9)
    expect(nearUpper.token0Share).toBeLessThan(0.1)
    expect(nearLower.token0Share).toBeGreaterThan(nearUpper.token0Share)
  })

  it("returns typed errors for an invalid budget and range", () => {
    const result = allocatePositionAmounts({
      amountUsdOrToken: 0,
      currentPrice: 2000,
      lowerPrice: 2500,
      upperPrice: 1500,
    })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.errors.amountUsdOrToken).toBe("Enter an amount greater than zero.")
    expect(result.errors.upperPrice).toBe("Upper price must be greater than lower price.")
  })
})

describe("simulatePriceScenarios", () => {
  const input = {
    currentPrice: 2000,
    lowerPrice: 1500,
    upperPrice: 2500,
    amount0: 0.25,
    amount1: 500,
    priceChangesPercent: [-50, -25, 0, 25, 50],
  } as const

  it("values the basket as amount0 * price + amount1 and flags range status", () => {
    const result = assertScenarioOk(simulatePriceScenarios(input))

    expect(result.entryValueUsd).toBeCloseTo(1000, 8)
    expect(result.scenarios).toHaveLength(5)

    const [downFifty, , flat, , upFifty] = result.scenarios
    if (!downFifty || !flat || !upFifty) throw new Error("Expected five scenarios")

    expect(downFifty.status).toBe("below") // 2000 * 0.5 = 1000 < 1500
    expect(downFifty.totalValueUsd).toBeCloseTo(0.25 * 1000 + 500, 8)
    expect(flat.status).toBe("inside")
    expect(flat.simulatedPrice).toBe(2000)
    expect(flat.changePercent).toBeCloseTo(0, 8)
    expect(upFifty.status).toBe("above") // 2000 * 1.5 = 3000 > 2500
    expect(upFifty.totalValueUsd).toBeCloseTo(0.25 * 3000 + 500, 8)
  })

  it("is deterministic across repeated calls", () => {
    expect(simulatePriceScenarios(input)).toEqual(simulatePriceScenarios(input))
  })

  it("estimates fees only while in range when a fee percent is given", () => {
    const withFees = assertScenarioOk(simulatePriceScenarios({ ...input, feePercent: 0.3 }))

    for (const scenario of withFees.scenarios) {
      if (scenario.status === "inside") {
        // entryValue 1000 · |Δ%| · 0.003
        expect(scenario.estimatedFeesUsd).toBeCloseTo(1000 * (Math.abs(scenario.priceChangePercent) / 100) * 0.003, 8)
      } else {
        expect(scenario.estimatedFeesUsd).toBe(0)
      }
    }
  })

  it("reports zero fees when no fee percent is given", () => {
    const withoutFees = assertScenarioOk(simulatePriceScenarios(input))

    for (const scenario of withoutFees.scenarios) {
      expect(scenario.estimatedFeesUsd).toBe(0)
    }
  })

  it("rejects invalid ranges and empty positions with typed errors", () => {
    const invalid = simulatePriceScenarios({ ...input, amount0: 0, amount1: 0, upperPrice: 1000 })

    expect(invalid.ok).toBe(false)
    if (invalid.ok) return
    expect(invalid.errors.upperPrice).toBe("Upper price must be greater than lower price.")
    expect(invalid.errors.amount0).toBe("Position value must be greater than zero.")
  })
})

describe("price derivation helpers", () => {
  it("derives price 1.0 from the canonical sqrtPriceX96 for tick 0", () => {
    expect(priceFromSqrtPriceX96("79228162514264337593543950336")).toBeCloseTo(1, 10)
  })

  it("returns 0 for a non-numeric sqrtPriceX96", () => {
    expect(priceFromSqrtPriceX96("not-a-number")).toBe(0)
  })
})
