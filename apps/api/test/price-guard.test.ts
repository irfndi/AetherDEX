import { describe, expect, it } from "vitest"
import { evaluatePriceGuard } from "../src/routes/price-guard"

describe("price guard", () => {
  it("accepts an opening price within the configured deviation", () => {
    const result = evaluatePriceGuard(2, 1, 0.51, 500, 123)

    expect(result.expectedPrice).toBe(0.5)
    expect(result.deviationBps).toBe(200)
    expect(result.valid).toBe(true)
    expect(result.checkedAt).toBe(123)
  })

  it("rejects an opening price outside the configured deviation", () => {
    const result = evaluatePriceGuard(2, 1, 0.6, 500, 123)

    expect(result.deviationBps).toBe(2_000)
    expect(result.valid).toBe(false)
  })
})
