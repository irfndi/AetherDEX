import { encodeAbiParameters, encodeEventTopics, getAddress, type Hex } from "viem"
import { describe, expect, it } from "vitest"
import { parseV4PoolManagerLog, toRawLog, V4_POOL_MANAGER_ABI } from "../../src/services/indexer-events"
import type { RawLog } from "../../src/services/v3-liquidity-events"

const poolManager = "0x0000000000000000000000000000000000044444" as const
const poolId = `0x${"ab".repeat(32)}` as const
const currency0 = "0x0000000000000000000000000000000000000a01" as const
const currency1 = "0x0000000000000000000000000000000000000b02" as const
const hooks = "0x00000000000000000000000000000000000c0de0" as const
const sender = "0x000000000000000000000000000000000000feed" as const
const txHash = `0x${"11".repeat(32)}` as const

const encodeV4 = (
  eventName: "Initialize" | "ModifyLiquidity" | "Swap",
  indexedArgs: Record<string, unknown>,
  params: readonly { readonly type: string }[],
  values: readonly unknown[],
): { data: Hex; topics: readonly Hex[] } => ({
  topics: encodeEventTopics({ abi: V4_POOL_MANAGER_ABI, eventName, args: indexedArgs }),
  data: encodeAbiParameters(params, values),
})

const toLog = (encoded: { data: Hex; topics: readonly Hex[] }, blockNumber: bigint, logIndex: number): RawLog => ({
  address: poolManager,
  data: encoded.data,
  topics: encoded.topics,
  transactionHash: txHash,
  logIndex,
  blockNumber,
})

describe("parseV4PoolManagerLog", () => {
  it("decodes an Initialize event into pool fields", () => {
    const encoded = encodeV4(
      "Initialize",
      { id: poolId, currency0, currency1 },
      [{ type: "uint24" }, { type: "int24" }, { type: "address" }, { type: "uint160" }, { type: "int24" }],
      [3000, 60, hooks, 79228162514264337593543950336n, -7],
    )
    const parsed = parseV4PoolManagerLog(toLog(encoded, 105n, 0))
    expect(parsed).toMatchObject({
      kind: "initialize",
      blockNumber: 105,
      logIndex: 0,
      txHash,
      poolId,
      currency0: getAddress(currency0),
      currency1: getAddress(currency1),
      fee: 3000,
      tickSpacing: 60,
      hooks: getAddress(hooks),
      sqrtPriceX96: "79228162514264337593543950336",
      tick: -7,
    })
  })

  it("decodes a Swap event and keeps signed delta amounts", () => {
    const encoded = encodeV4(
      "Swap",
      { id: poolId, sender },
      [
        { type: "int128" },
        { type: "int128" },
        { type: "uint160" },
        { type: "uint128" },
        { type: "int24" },
        { type: "uint24" },
      ],
      [-1000n, 2500n, 79328000000000000000000000000n, 777777n, 5, 500],
    )
    const parsed = parseV4PoolManagerLog(toLog(encoded, 106n, 1))
    expect(parsed).toMatchObject({
      kind: "swap",
      poolId,
      sender: getAddress(sender),
      amount0: -1000n,
      amount1: 2500n,
      liquidity: "777777",
      tick: 5,
      fee: 500,
    })
  })

  it("decodes a ModifyLiquidity event with a negative liquidityDelta", () => {
    const encoded = encodeV4(
      "ModifyLiquidity",
      { id: poolId, sender },
      [{ type: "int24" }, { type: "int24" }, { type: "int256" }, { type: "bytes32" }],
      [-120, 120, -555n, `0x${"22".repeat(32)}`],
    )
    const parsed = parseV4PoolManagerLog(toLog(encoded, 107n, 2))
    expect(parsed).toMatchObject({
      kind: "modify_liquidity",
      poolId,
      sender: getAddress(sender),
      tickLower: -120,
      tickUpper: 120,
      liquidityDelta: -555n,
    })
  })

  it("returns null for an unknown event signature", () => {
    expect(
      parseV4PoolManagerLog({
        address: poolManager,
        data: "0x",
        topics: [`0x${"99".repeat(32)}`],
        transactionHash: txHash,
        logIndex: 3,
        blockNumber: 108n,
      }),
    ).toBeNull()
  })
})

describe("toRawLog", () => {
  it("normalizes complete viem logs and rejects incomplete ones", () => {
    expect(
      toRawLog({
        address: poolManager,
        data: "0x",
        topics: [],
        transactionHash: txHash,
        logIndex: 4,
        blockNumber: 200n,
      }),
    ).toEqual({
      address: poolManager,
      data: "0x",
      topics: [],
      transactionHash: txHash,
      logIndex: 4n,
      blockNumber: 200n,
    })
    expect(
      toRawLog({ address: poolManager, data: "0x", topics: [], transactionHash: null, logIndex: 4, blockNumber: 200n }),
    ).toBeNull()
    expect(
      toRawLog({
        address: poolManager,
        data: "0x",
        topics: [],
        transactionHash: txHash,
        logIndex: null,
        blockNumber: 200n,
      }),
    ).toBeNull()
    expect(
      toRawLog({
        address: poolManager,
        data: "0x",
        topics: [],
        transactionHash: txHash,
        logIndex: 4,
        blockNumber: null,
      }),
    ).toBeNull()
  })
})
