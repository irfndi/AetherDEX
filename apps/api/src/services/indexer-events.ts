/**
 * Phase 3 indexer event decoding.
 *
 * Pure (side-effect-free) decoders for the on-chain logs the indexer ingests:
 * - v4 PoolManager events (Initialize / ModifyLiquidity / Swap) via a minimal
 *   human-readable ABI + viem's `decodeEventLog`;
 * - a shared `RawLog` normalizer for viem `getLogs` results (reused for v3
 *   parsing via `parseV3LiquidityLog` in v3-liquidity-events.ts).
 */

import { decodeEventLog, getAddress, type Hex, parseAbi } from "viem"
import type { RawLog } from "./v3-liquidity-events"

/** Minimal human-readable ABI for the v4 PoolManager events the indexer cares about. */
export const V4_POOL_MANAGER_ABI = parseAbi([
  "event Initialize(bytes32 indexed id, address indexed currency0, address indexed currency1, uint24 fee, int24 tickSpacing, address hooks, uint160 sqrtPriceX96, int24 tick)",
  "event ModifyLiquidity(bytes32 indexed id, address indexed sender, int24 tickLower, int24 tickUpper, int256 liquidityDelta, bytes32 salt)",
  "event Swap(bytes32 indexed id, address indexed sender, int128 amount0, int128 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick, uint24 fee)",
])

interface DecodedLogLocation {
  readonly blockNumber: number
  readonly logIndex: number
  readonly txHash: `0x${string}`
}

export type V4InitializeEvent = DecodedLogLocation & {
  readonly kind: "initialize"
  readonly poolId: string
  readonly currency0: `0x${string}`
  readonly currency1: `0x${string}`
  readonly fee: number
  readonly tickSpacing: number
  readonly hooks: `0x${string}`
  readonly sqrtPriceX96: string
  readonly tick: number
}

export type V4ModifyLiquidityEvent = DecodedLogLocation & {
  readonly kind: "modify_liquidity"
  readonly poolId: string
  readonly sender: `0x${string}`
  readonly tickLower: number
  readonly tickUpper: number
  readonly liquidityDelta: bigint
}

export type V4SwapEvent = DecodedLogLocation & {
  readonly kind: "swap"
  readonly poolId: string
  readonly sender: `0x${string}`
  readonly amount0: bigint
  readonly amount1: bigint
  readonly sqrtPriceX96: string
  readonly liquidity: string
  readonly tick: number
  readonly fee: number
}

export type V4PoolManagerEvent = V4InitializeEvent | V4ModifyLiquidityEvent | V4SwapEvent

/**
 * Decode a v4 PoolManager log. Returns `null` for unknown topics or malformed
 * payloads so the indexer can skip events outside its ABI without failing the
 * whole batch.
 */
export function parseV4PoolManagerLog(log: RawLog): V4PoolManagerEvent | null {
  try {
    const decoded = decodeEventLog({
      abi: V4_POOL_MANAGER_ABI,
      data: log.data,
      topics: [...log.topics] as [Hex, ...Hex[]],
    })
    const base = {
      blockNumber: Number(log.blockNumber),
      logIndex: Number(log.logIndex),
      txHash: log.transactionHash,
    }
    switch (decoded.eventName) {
      case "Initialize": {
        const args = decoded.args
        return {
          ...base,
          kind: "initialize",
          poolId: args.id,
          currency0: getAddress(args.currency0),
          currency1: getAddress(args.currency1),
          fee: Number(args.fee),
          tickSpacing: Number(args.tickSpacing),
          hooks: getAddress(args.hooks),
          sqrtPriceX96: args.sqrtPriceX96.toString(),
          tick: Number(args.tick),
        }
      }
      case "ModifyLiquidity": {
        const args = decoded.args
        return {
          ...base,
          kind: "modify_liquidity",
          poolId: args.id,
          sender: getAddress(args.sender),
          tickLower: Number(args.tickLower),
          tickUpper: Number(args.tickUpper),
          liquidityDelta: args.liquidityDelta,
        }
      }
      case "Swap": {
        const args = decoded.args
        return {
          ...base,
          kind: "swap",
          poolId: args.id,
          sender: getAddress(args.sender),
          amount0: args.amount0,
          amount1: args.amount1,
          sqrtPriceX96: args.sqrtPriceX96.toString(),
          liquidity: args.liquidity.toString(),
          tick: Number(args.tick),
          fee: Number(args.fee),
        }
      }
    }
  } catch {
    return null
  }
  return null
}

/**
 * Shape of a log entry returned by viem's `client.getLogs`. Pending-log fields
 * (`transactionHash`, `logIndex`, `blockNumber`) are nullable; such entries are
 * rejected since they cannot be persisted against a block.
 */
export interface IndexableLog {
  readonly address: `0x${string}`
  readonly data: `0x${string}`
  readonly topics: readonly `0x${string}`[]
  readonly transactionHash: `0x${string}` | null
  readonly logIndex: bigint | number | null
  readonly blockNumber: bigint | number | null
}

/** Normalize a viem log into the parser-friendly `RawLog`, or `null` if incomplete. */
export function toRawLog(log: IndexableLog): RawLog | null {
  if (log.transactionHash === null || log.logIndex === null || log.blockNumber === null) return null
  return {
    address: log.address,
    data: log.data,
    topics: log.topics,
    transactionHash: log.transactionHash,
    logIndex: BigInt(log.logIndex),
    blockNumber: BigInt(log.blockNumber),
  }
}
