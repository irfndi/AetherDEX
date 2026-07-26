import { encodeAbiParameters, encodeEventTopics, parseAbiItem } from "viem"
import { describe, expect, it } from "vitest"
import { parseV3LiquidityLog } from "../../src/services/v3-liquidity-events"

const manager = "0x0000000000000000000000000000000000000100" as const
const pool = "0x0000000000000000000000000000000000000200" as const
const txHash = `0x${"11".repeat(32)}` as const

describe("parseV3LiquidityLog", () => {
  it("normalizes position-manager liquidity events", () => {
    const event = parseAbiItem(
      "event IncreaseLiquidity(uint256 indexed tokenId, uint128 liquidity, uint256 amount0, uint256 amount1)",
    )
    const topics = encodeEventTopics({ abi: [event], eventName: "IncreaseLiquidity", args: [7n] })
    const data = encodeAbiParameters([{ type: "uint128" }, { type: "uint256" }, { type: "uint256" }], [500n, 11n, 13n])
    const parsed = parseV3LiquidityLog(
      { address: manager, topics, data, transactionHash: txHash, logIndex: 2, blockNumber: 100n },
      { positionManager: manager },
    )
    expect(parsed).toMatchObject({
      eventType: "increase",
      tokenId: "7",
      liquidityDelta: "500",
      amount0: "11",
      amount1: "13",
    })
  })

  it("normalizes pool mint events and ignores unrelated addresses", () => {
    const event = parseAbiItem(
      "event Mint(address sender, address indexed owner, int24 indexed tickLower, int24 indexed tickUpper, uint128 amount, uint256 amount0, uint256 amount1)",
    )
    const sender = "0x0000000000000000000000000000000000000008" as const
    const owner = "0x0000000000000000000000000000000000000007" as const
    const topics = encodeEventTopics({ abi: [event], eventName: "Mint", args: [owner, -120, 120] })
    const data = encodeAbiParameters(
      [{ type: "address" }, { type: "uint128" }, { type: "uint256" }, { type: "uint256" }],
      [sender, 9n, 10n, 12n],
    )
    const parsed = parseV3LiquidityLog(
      { address: pool, topics, data, transactionHash: txHash, logIndex: 3, blockNumber: 101 },
      { positionManager: manager, poolAddress: pool, poolId: "pool-1" },
    )
    expect(parsed).toMatchObject({ eventType: "mint", poolId: "pool-1", tickLower: -120, tickUpper: 120 })
    expect(
      parseV3LiquidityLog(
        {
          address: "0x0000000000000000000000000000000000000300",
          topics,
          data,
          transactionHash: txHash,
          logIndex: 3,
          blockNumber: 101,
        },
        { positionManager: manager },
      ),
    ).toBeNull()
  })

  it("decodes a Collect event with a non-indexed recipient", () => {
    const event = parseAbiItem(
      "event Collect(uint256 indexed tokenId, address recipient, uint256 amount0, uint256 amount1)",
    )
    const topics = encodeEventTopics({ abi: [event], eventName: "Collect", args: [7n] })
    const data = encodeAbiParameters(
      [{ type: "address" }, { type: "uint256" }, { type: "uint256" }],
      ["0x0000000000000000000000000000000000000007", 17n, 19n],
    )
    const parsed = parseV3LiquidityLog(
      { address: manager, topics, data, transactionHash: txHash, logIndex: 4, blockNumber: 102 },
      { positionManager: manager },
    )
    expect(parsed).toMatchObject({ eventType: "collect", tokenId: "7", amount0: "17", amount1: "19" })
  })
})
