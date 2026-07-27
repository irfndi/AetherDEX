import { describe, expect, it } from "vitest"
import { selectIndexedPosition } from "../../src/routes/positions"

const positions = [
  { id: 1, poolId: "pool-1", tickSpacing: 10, tickLower: -100, tickUpper: 100, liquidity: "1" },
  { id: 2, poolId: "pool-2", tickSpacing: 60, tickLower: -600, tickUpper: 600, liquidity: "2" },
]

describe("position selection", () => {
  it("returns the requested indexed position", () => {
    expect(selectIndexedPosition(positions, 2)?.poolId).toBe("pool-2")
  })

  it("falls back to the first position when selection is unavailable", () => {
    expect(selectIndexedPosition(positions, null)?.id).toBe(1)
    expect(selectIndexedPosition(positions, 99)?.id).toBe(1)
  })
})
