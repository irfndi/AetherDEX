import { describe, expect, it } from "vitest"
import type { V3LiquidityEvent } from "../../src/services/v3-liquidity-events"
import { reduceV3PositionEvents } from "../../src/services/v3-position-reducer"

const owner = "0x0000000000000000000000000000000000000007" as const
const event = (overrides: Partial<V3LiquidityEvent>): V3LiquidityEvent => ({
  protocol: "v3",
  eventType: "increase",
  txHash: `0x${"11".repeat(32)}`,
  logIndex: 0,
  blockNumber: 1,
  poolId: null,
  tokenId: "7",
  ownerAddress: owner,
  tickLower: null,
  tickUpper: null,
  liquidityDelta: "100",
  amount0: "10",
  amount1: "20",
  ...overrides,
})

describe("reduceV3PositionEvents", () => {
  it("reconciles transfer, liquidity, and fee events in chain order", () => {
    const positions = reduceV3PositionEvents([
      event({ eventType: "transfer", blockNumber: 3, ownerAddress: owner }),
      event({ eventType: "increase", blockNumber: 2 }),
      event({ eventType: "collect", blockNumber: 4, amount0: "2", amount1: "3" }),
      event({ eventType: "decrease", blockNumber: 5, liquidityDelta: "40", amount0: "4", amount1: "8" }),
    ])
    expect(positions.get("7")).toMatchObject({
      ownerAddress: owner,
      isActive: true,
      liquidity: 60n,
      amount0: 6n,
      amount1: 12n,
      fees0: 2n,
      fees1: 3n,
      costBasis0: 10n,
      costBasis1: 20n,
    })
  })

  it("does not count withdrawn principal as fees", () => {
    const positions = reduceV3PositionEvents([
      event({ eventType: "increase", amount0: "100", amount1: "200" }),
      event({ eventType: "decrease", liquidityDelta: "40", amount0: "40", amount1: "80" }),
      event({ eventType: "collect", amount0: "40", amount1: "90" }),
    ])
    expect(positions.get("7")).toMatchObject({ fees0: 0n, fees1: 10n })
  })

  it("does not publish an invalid underflowed state", () => {
    const positions = reduceV3PositionEvents([event({ eventType: "decrease", liquidityDelta: "101" })])
    expect(positions.has("7")).toBe(false)
  })
})
