import { decodeEventLog, getAddress, type Hex } from "viem"

const POSITION_MANAGER_ABI = [
  {
    type: "event",
    name: "IncreaseLiquidity",
    inputs: [
      { indexed: true, name: "tokenId", type: "uint256" },
      { indexed: false, name: "liquidity", type: "uint128" },
      { indexed: false, name: "amount0", type: "uint256" },
      { indexed: false, name: "amount1", type: "uint256" },
    ],
  },
  {
    type: "event",
    name: "DecreaseLiquidity",
    inputs: [
      { indexed: true, name: "tokenId", type: "uint256" },
      { indexed: false, name: "liquidity", type: "uint128" },
      { indexed: false, name: "amount0", type: "uint256" },
      { indexed: false, name: "amount1", type: "uint256" },
    ],
  },
  {
    type: "event",
    name: "Collect",
    inputs: [
      { indexed: true, name: "tokenId", type: "uint256" },
      { indexed: true, name: "recipient", type: "address" },
      { indexed: false, name: "amount0", type: "uint256" },
      { indexed: false, name: "amount1", type: "uint256" },
    ],
  },
  {
    type: "event",
    name: "Transfer",
    inputs: [
      { indexed: true, name: "from", type: "address" },
      { indexed: true, name: "to", type: "address" },
      { indexed: true, name: "tokenId", type: "uint256" },
    ],
  },
] as const

const POOL_ABI = [
  {
    type: "event",
    name: "Mint",
    inputs: [
      { indexed: false, name: "sender", type: "address" },
      { indexed: true, name: "owner", type: "address" },
      { indexed: true, name: "tickLower", type: "int24" },
      { indexed: true, name: "tickUpper", type: "int24" },
      { indexed: false, name: "amount", type: "uint128" },
      { indexed: false, name: "amount0", type: "uint256" },
      { indexed: false, name: "amount1", type: "uint256" },
    ],
  },
  {
    type: "event",
    name: "Burn",
    inputs: [
      { indexed: true, name: "owner", type: "address" },
      { indexed: true, name: "tickLower", type: "int24" },
      { indexed: true, name: "tickUpper", type: "int24" },
      { indexed: false, name: "amount", type: "uint128" },
      { indexed: false, name: "amount0", type: "uint256" },
      { indexed: false, name: "amount1", type: "uint256" },
    ],
  },
] as const

export type V3LiquidityEvent = {
  readonly protocol: "v3"
  readonly eventType: "mint" | "burn" | "increase" | "decrease" | "collect" | "transfer"
  readonly txHash: `0x${string}`
  readonly logIndex: number
  readonly blockNumber: number
  readonly poolId: string | null
  readonly tokenId: string | null
  readonly ownerAddress: `0x${string}` | null
  readonly tickLower: number | null
  readonly tickUpper: number | null
  readonly liquidityDelta: string | null
  readonly amount0: string | null
  readonly amount1: string | null
}

export type RawLog = {
  readonly address: `0x${string}`
  readonly data: Hex
  readonly topics: readonly Hex[]
  readonly transactionHash: `0x${string}`
  readonly logIndex: number | bigint
  readonly blockNumber: number | bigint
}

export function parseV3LiquidityLog(
  log: RawLog,
  config: { readonly positionManager: `0x${string}`; readonly poolAddress?: `0x${string}`; readonly poolId?: string },
): V3LiquidityEvent | null {
  const address = log.address.toLowerCase()
  if (address === config.positionManager.toLowerCase()) return parsePositionManagerLog(log)
  if (config.poolAddress && address === config.poolAddress.toLowerCase()) {
    return parsePoolLog(log, config.poolId ?? null)
  }
  return null
}

function parsePositionManagerLog(log: RawLog): V3LiquidityEvent | null {
  try {
    const decoded = decodeEventLog({
      abi: POSITION_MANAGER_ABI,
      data: log.data,
      topics: [...log.topics] as [Hex, ...Hex[]],
    })
    const args = decoded.args
    const tokenId = "tokenId" in args ? args.tokenId : null
    if (typeof tokenId !== "bigint") return null
    const base = {
      protocol: "v3" as const,
      txHash: log.transactionHash,
      logIndex: Number(log.logIndex),
      blockNumber: Number(log.blockNumber),
      poolId: null,
      tokenId: tokenId.toString(),
      ownerAddress: null,
      tickLower: null,
      tickUpper: null,
      liquidityDelta: null,
      amount0: null,
      amount1: null,
    }
    if (decoded.eventName === "IncreaseLiquidity" || decoded.eventName === "DecreaseLiquidity") {
      if (!("liquidity" in args) || typeof args.liquidity !== "bigint") return null
      return {
        ...base,
        eventType: decoded.eventName === "IncreaseLiquidity" ? "increase" : "decrease",
        liquidityDelta: args.liquidity.toString(),
        amount0: "amount0" in args && typeof args.amount0 === "bigint" ? args.amount0.toString() : null,
        amount1: "amount1" in args && typeof args.amount1 === "bigint" ? args.amount1.toString() : null,
      }
    }
    if (decoded.eventName === "Collect") {
      if (!("recipient" in args) || typeof args.recipient !== "string") return null
      return {
        ...base,
        eventType: "collect",
        ownerAddress: getAddress(args.recipient),
        amount0: "amount0" in args && typeof args.amount0 === "bigint" ? args.amount0.toString() : null,
        amount1: "amount1" in args && typeof args.amount1 === "bigint" ? args.amount1.toString() : null,
      }
    }
    if (decoded.eventName === "Transfer") {
      if (!("to" in args) || typeof args.to !== "string") return null
      return { ...base, eventType: "transfer", ownerAddress: getAddress(args.to) }
    }
    return null
  } catch {
    return null
  }
}

function parsePoolLog(log: RawLog, poolId: string | null): V3LiquidityEvent | null {
  try {
    const decoded = decodeEventLog({ abi: POOL_ABI, data: log.data, topics: [...log.topics] as [Hex, ...Hex[]] })
    const args = decoded.args
    if (!("owner" in args) || typeof args.owner !== "string") return null
    if (!("tickLower" in args) || !isIntegerValue(args.tickLower)) return null
    if (!("tickUpper" in args) || !isIntegerValue(args.tickUpper)) return null
    return {
      protocol: "v3",
      eventType: decoded.eventName === "Mint" ? "mint" : "burn",
      txHash: log.transactionHash,
      logIndex: Number(log.logIndex),
      blockNumber: Number(log.blockNumber),
      poolId,
      tokenId: null,
      ownerAddress: getAddress(args.owner),
      tickLower: Number(args.tickLower),
      tickUpper: Number(args.tickUpper),
      liquidityDelta: "amount" in args && typeof args.amount === "bigint" ? args.amount.toString() : null,
      amount0: "amount0" in args && typeof args.amount0 === "bigint" ? args.amount0.toString() : null,
      amount1: "amount1" in args && typeof args.amount1 === "bigint" ? args.amount1.toString() : null,
    }
  } catch {
    return null
  }
}

function isIntegerValue(value: unknown): value is bigint | number {
  return (typeof value === "bigint" || typeof value === "number") && Number.isSafeInteger(Number(value))
}
