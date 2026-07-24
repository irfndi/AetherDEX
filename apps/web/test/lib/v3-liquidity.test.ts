import { FeeAmount } from "@uniswap/v3-sdk"
import { describe, expect, it } from "vitest"
import {
  buildV3MintCall,
  buildV3PoolCreateCall,
  buildV3PoolContext,
  buildV3RebalancePlan,
  buildV3SingleSidedPlan,
  snapV3Tick,
} from "../../src/lib/v3-liquidity"

const pool = buildV3PoolContext({
  chainId: 11155111,
  token0: "0x1111111111111111111111111111111111111111",
  token1: "0x2222222222222222222222222222222222222222",
  token0Decimals: 18,
  token1Decimals: 18,
  fee: FeeAmount.MEDIUM,
  sqrtPriceX96: 79228162514264337593543950336n,
  liquidity: 1_000_000_000_000n,
  currentTick: 0,
})

const recipient = "0x3333333333333333333333333333333333333333" as const

describe("v3 liquidity adapter", () => {
  it("snaps ticks to the pool spacing", () => {
    expect(snapV3Tick(121, 60)).toBe(120)
  })

  it("builds v3 mint calldata from concentrated-liquidity amounts", () => {
    const mint = buildV3MintCall({
      pool,
      tickLower: -600,
      tickUpper: 600,
      amount0: 1_000_000_000_000n,
      amount1: 1_000_000_000_000n,
      slippageBps: 50,
      deadline: 2_000_000_000n,
      recipient,
    })

    expect(mint.kind).toBe("v3-mint")
    expect(mint.method.calldata).toMatch(/^0x[0-9a-f]+$/)
    expect(mint.method.value).toBe("0x00")
  })

  it("builds v3 pool initialization calldata", () => {
    const create = buildV3PoolCreateCall({
      chainId: 11155111,
      token0: pool.token0.address as `0x${string}`,
      token1: pool.token1.address as `0x${string}`,
      token0Decimals: 18,
      token1Decimals: 18,
      fee: FeeAmount.MEDIUM,
      sqrtPriceX96: 79228162514264337593543950336n,
      liquidity: 1_000_000_000_000n,
      currentTick: 0,
    })

    expect(create.kind).toBe("v3-create-pool")
    expect(create.method.calldata).toMatch(/^0x[0-9a-f]+$/)
  })

  it("builds an ordered exit and remint rebalance plan", () => {
    const plan = buildV3RebalancePlan({
      pool,
      tokenId: 42n,
      currentLiquidity: 1_000_000n,
      expectedOwed0: 10n,
      expectedOwed1: 20n,
      recipient,
      currentRange: { tickLower: -600, tickUpper: 600 },
      newRange: { tickLower: -1200, tickUpper: 1200 },
      amount0: 1_000_000_000n,
      amount1: 1_000_000_000n,
      slippageBps: 50,
      deadline: 2_000_000_000n,
    })

    expect(plan.kind).toBe("v3-rebalance")
    expect(plan.exit.calldata).toMatch(/^0x[0-9a-f]+$/)
    expect(plan.remint.method.calldata).toMatch(/^0x[0-9a-f]+$/)
    expect(plan.execution).toBe("requires-private-batched-submission")
  })

  it("keeps single-sided swap and mint under a private batch gate", () => {
    const plan = buildV3SingleSidedPlan({
      swap: { calldata: "0x1234", value: "0x00" },
      mint: {
        pool,
        tickLower: -600,
        tickUpper: 600,
        amount0: 1_000_000_000n,
        amount1: 1_000_000_000n,
        slippageBps: 50,
        deadline: 2_000_000_000n,
        recipient,
      },
    })

    expect(plan.swap.calldata).toBe("0x1234")
    expect(plan.mint.kind).toBe("v3-mint")
    expect(plan.execution).toBe("requires-private-batched-submission")
  })
})
