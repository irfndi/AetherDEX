import { describe, expect, it } from "vitest"
import {
  buildRebalanceIntent,
  validateRebalanceForm,
  type RebalanceFormValues,
  type RebalancePosition,
} from "../../src/lib/rebalance"

const position: RebalancePosition = {
  positionId: "#1842",
  poolId: "0xpool-eth-usdc",
  pair: "ETH / USDC",
  token0: "ETH",
  token1: "USDC",
  currentLowerTick: -600,
  currentUpperTick: 600,
  tickSpacing: 60,
  liquidity: "12.48",
}

const validValues: RebalanceFormValues = {
  lowerTick: "-1200",
  upperTick: "1200",
  slippage: "0.5",
  deadline: "1800",
}

describe("rebalance intent helpers", () => {
  it("accepts an aligned range and bounded execution settings", () => {
    expect(validateRebalanceForm(validValues, position.tickSpacing)).toEqual({ valid: true, errors: {} })
  })

  it("reports range, tick spacing, slippage, and deadline errors", () => {
    const result = validateRebalanceForm(
      { ...validValues, lowerTick: "-121", upperTick: "-180", slippage: "6", deadline: "30" },
      position.tickSpacing,
    )

    expect(result.valid).toBe(false)
    expect(result.errors).toMatchObject({
      lowerTick: "Use a multiple of 60.",
      upperTick: "Upper tick must be greater than lower tick.",
      slippage: "Use a value from 0% to 5%.",
      deadline: "Use a deadline between 1 minute and 24 hours.",
    })
  })

  it("builds an explicit ordered intent without calldata or success", () => {
    expect(buildRebalanceIntent(position, validValues)).toEqual({
      kind: "aetherdex.rebalance",
      position: {
        positionId: "#1842",
        poolId: "0xpool-eth-usdc",
        pair: "ETH / USDC",
        token0: "ETH",
        token1: "USDC",
        currentLowerTick: -600,
        currentUpperTick: 600,
        tickSpacing: 60,
        liquidity: "12.48",
      },
      newRange: { lowerTick: -1200, upperTick: 1200 },
      slippageBps: 50,
      deadlineSeconds: 1800,
      steps: [
        { kind: "close", description: "Close the selected position." },
        { kind: "collect", description: "Collect tokens and fees from the closed position." },
        { kind: "remint", description: "Re-mint the position in the new tick range." },
      ],
      execution: {
        status: "unavailable",
        reason: "manager-router-not-configured",
      },
    })
  })

  it("does not build an intent for an invalid range", () => {
    expect(buildRebalanceIntent(position, { ...validValues, upperTick: "-1200" })).toBeNull()
  })
})
