import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { allocatePositionAmounts, simulatePriceScenarios } from "../../src/lib/playground"
import { ScenarioTable } from "../../src/routes/playground"

const buildScenarios = (feePercent?: number) => {
  const allocation = allocatePositionAmounts({
    amountUsdOrToken: 1000,
    currentPrice: 2000,
    lowerPrice: 1500,
    upperPrice: 2500,
  })
  if (!allocation.ok) throw new Error("allocation should be valid in tests")
  const result = simulatePriceScenarios({
    currentPrice: 2000,
    lowerPrice: 1500,
    upperPrice: 2500,
    amount0: allocation.amount0,
    amount1: allocation.amount1,
    priceChangesPercent: [-50, 0, 50],
    feePercent,
  })
  if (!result.ok) throw new Error("scenarios should be valid in tests")
  return result.scenarios
}

describe("ScenarioTable", () => {
  it("renders one row per scenario with in/out of range badges", () => {
    render(<ScenarioTable scenarios={buildScenarios()} showFees={false} />)

    expect(screen.getByText("Simulated price")).toBeDefined()
    expect(screen.getByText("+50%")).toBeDefined()
    expect(screen.getByText("-50%")).toBeDefined()
    expect(screen.getAllByText("Out of range")).toHaveLength(2)
    expect(screen.getAllByText("In range")).toHaveLength(1)
    expect(screen.queryByText("Est. fees")).toBeNull()
  })

  it("shows the fee column only when fees are enabled", () => {
    render(<ScenarioTable scenarios={buildScenarios(0.3)} showFees />)

    expect(screen.getByText("Est. fees")).toBeDefined()
    // Out-of-range rows accrue no fees under the documented assumption.
    const feeCells = screen.getAllByText("$0")
    expect(feeCells.length).toBeGreaterThanOrEqual(2)
  })
})
