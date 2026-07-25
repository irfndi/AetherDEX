import { Token } from "@uniswap/sdk-core"
import { Pool, Position } from "@uniswap/v4-sdk"
import { encodeFunctionData, type Hex } from "viem"

export type RebalancePosition = {
  readonly positionId: string
  readonly poolId: string
  readonly pair: string
  readonly token0: string
  readonly token1: string
  readonly currentLowerTick: number
  readonly currentUpperTick: number
  readonly tickSpacing: number
  readonly liquidity: string
}

export type RebalanceFormValues = {
  readonly lowerTick: string
  readonly upperTick: string
  readonly slippage: string
  readonly deadline: string
}

export type RebalanceField = keyof RebalanceFormValues
export type RebalanceErrors = Partial<Record<RebalanceField, string>>

export type RebalanceValidation = {
  readonly valid: boolean
  readonly errors: RebalanceErrors
}

export type RebalanceStep =
  | { readonly kind: "close"; readonly description: string }
  | { readonly kind: "collect"; readonly description: string }
  | { readonly kind: "remint"; readonly description: string }

export type RebalanceIntent = {
  readonly kind: "aetherdex.rebalance"
  readonly position: RebalancePosition
  readonly newRange: {
    readonly lowerTick: number
    readonly upperTick: number
  }
  readonly slippageBps: number
  readonly deadlineSeconds: number
  readonly steps: readonly RebalanceStep[]
  readonly execution: {
    readonly status: "unavailable"
    readonly reason: "manager-router-not-configured"
  }
}

export type RebalanceManagerParams = {
  readonly tokenId: bigint
  readonly tickLower: number
  readonly tickUpper: number
  readonly liquidity: bigint
  readonly amount0Max: bigint
  readonly amount1Max: bigint
  readonly amount0Min: bigint
  readonly amount1Min: bigint
  readonly deadline: bigint
  readonly hookData: `0x${string}`
}

export type RebalanceManagerCall = {
  readonly address: `0x${string}`
  readonly functionName: "rebalancePosition"
  readonly args: readonly [RebalanceManagerParams]
}

export type V4RebalancePoolInput = {
  readonly chainId: number
  readonly token0: `0x${string}`
  readonly token1: `0x${string}`
  readonly token0Decimals: number
  readonly token1Decimals: number
  readonly fee: number
  readonly tickSpacing: number
  readonly hooks: `0x${string}`
  readonly sqrtPriceX96: bigint
  readonly poolLiquidity: bigint
  readonly currentTick: number
}

export type V4RebalanceBuildInput = {
  readonly managerAddress: `0x${string}`
  readonly pool: V4RebalancePoolInput
  readonly tokenId: bigint
  readonly currentLiquidity: bigint
  readonly currentRange: { readonly tickLower: number; readonly tickUpper: number }
  readonly newRange: { readonly tickLower: number; readonly tickUpper: number }
  readonly slippageBps: number
  readonly deadline: bigint
  readonly hookData?: Hex
}

export type V4RebalanceCall = RebalanceManagerCall & {
  readonly calldata: Hex
  readonly expectedClosedAmount0: bigint
  readonly expectedClosedAmount1: bigint
  readonly expectedMintAmount0: bigint
  readonly expectedMintAmount1: bigint
}

const AETHER_POSITION_MANAGER_ABI = [
  {
    name: "rebalancePosition",
    type: "function",
    stateMutability: "payable",
    inputs: [
      {
        name: "params",
        type: "tuple",
        components: [
          { name: "tokenId", type: "uint256" },
          { name: "tickLower", type: "int24" },
          { name: "tickUpper", type: "int24" },
          { name: "liquidity", type: "uint128" },
          { name: "amount0Max", type: "uint256" },
          { name: "amount1Max", type: "uint256" },
          { name: "amount0Min", type: "uint256" },
          { name: "amount1Min", type: "uint256" },
          { name: "deadline", type: "uint256" },
          { name: "hookData", type: "bytes" },
        ],
      },
    ],
    outputs: [
      { name: "closedAmount0", type: "uint256" },
      { name: "closedAmount1", type: "uint256" },
      { name: "usedAmount0", type: "uint256" },
      { name: "usedAmount1", type: "uint256" },
    ],
  },
] as const

export function buildV4RebalanceCall(input: V4RebalanceBuildInput): V4RebalanceCall {
  if (input.currentLiquidity <= 0n) throw new Error("V4 position liquidity must be positive")
  if (input.slippageBps < 0 || input.slippageBps > 500) throw new Error("V4 rebalance slippage is invalid")
  if (input.deadline <= 0n) throw new Error("V4 rebalance deadline is invalid")
  const token0 = new Token(input.pool.chainId, input.pool.token0, input.pool.token0Decimals)
  const token1 = new Token(input.pool.chainId, input.pool.token1, input.pool.token1Decimals)
  const pool = new Pool(
    token0,
    token1,
    input.pool.fee,
    input.pool.tickSpacing,
    input.pool.hooks,
    input.pool.sqrtPriceX96.toString(),
    input.pool.poolLiquidity.toString(),
    input.pool.currentTick,
  )
  const currentPosition = new Position({
    pool,
    tickLower: input.currentRange.tickLower,
    tickUpper: input.currentRange.tickUpper,
    liquidity: input.currentLiquidity.toString(),
  })
  const nextPosition = Position.fromAmounts({
    pool,
    tickLower: input.newRange.tickLower,
    tickUpper: input.newRange.tickUpper,
    amount0: currentPosition.mintAmounts.amount0.toString(),
    amount1: currentPosition.mintAmounts.amount1.toString(),
    useFullPrecision: true,
  })
  const expectedClosedAmount0 = BigInt(currentPosition.mintAmounts.amount0.toString())
  const expectedClosedAmount1 = BigInt(currentPosition.mintAmounts.amount1.toString())
  const expectedMintAmount0 = BigInt(nextPosition.mintAmounts.amount0.toString())
  const expectedMintAmount1 = BigInt(nextPosition.mintAmounts.amount1.toString())
  const factor = BPS - BigInt(input.slippageBps)
  const params = {
    tokenId: input.tokenId,
    tickLower: input.newRange.tickLower,
    tickUpper: input.newRange.tickUpper,
    liquidity: BigInt(nextPosition.liquidity.toString()),
    amount0Max: expectedMintAmount0,
    amount1Max: expectedMintAmount1,
    amount0Min: (expectedClosedAmount0 * factor) / BPS,
    amount1Min: (expectedClosedAmount1 * factor) / BPS,
    deadline: input.deadline,
    hookData: input.hookData ?? "0x",
  } satisfies RebalanceManagerParams
  return {
    ...buildRebalanceManagerCall(input.managerAddress, params),
    calldata: encodeFunctionData({ abi: AETHER_POSITION_MANAGER_ABI, functionName: "rebalancePosition", args: [params] }),
    expectedClosedAmount0,
    expectedClosedAmount1,
    expectedMintAmount0,
    expectedMintAmount1,
  }
}

export function buildRebalanceManagerCall(
  managerAddress: `0x${string}`,
  params: RebalanceManagerParams,
): RebalanceManagerCall {
  return {
    address: managerAddress,
    functionName: "rebalancePosition",
    args: [params],
  }
}

const MAX_SLIPPAGE_BPS = 500
const MIN_DEADLINE_SECONDS = 60
const MAX_DEADLINE_SECONDS = 86_400

function parseInteger(value: string): number | null {
  if (!/^-?\d+$/.test(value.trim())) return null
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) ? parsed : null
}

function parseDecimal(value: string): number | null {
  if (!/^\d+(\.\d+)?$/.test(value.trim())) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

export function validateRebalanceForm(values: RebalanceFormValues, tickSpacing: number): RebalanceValidation {
  const errors: RebalanceErrors = {}
  const lowerTick = parseInteger(values.lowerTick)
  const upperTick = parseInteger(values.upperTick)
  const slippage = parseDecimal(values.slippage)
  const deadline = parseInteger(values.deadline)

  if (!Number.isSafeInteger(tickSpacing) || tickSpacing <= 0) {
    errors.lowerTick = "This pool has no valid tick spacing."
    errors.upperTick = "This pool has no valid tick spacing."
  } else {
    if (lowerTick === null) errors.lowerTick = "Enter a whole-number lower tick."
    if (upperTick === null) errors.upperTick = "Enter a whole-number upper tick."
    if (lowerTick !== null && lowerTick % tickSpacing !== 0) errors.lowerTick = `Use a multiple of ${tickSpacing}.`
    if (upperTick !== null && upperTick % tickSpacing !== 0) errors.upperTick = `Use a multiple of ${tickSpacing}.`
    if (lowerTick !== null && upperTick !== null && lowerTick >= upperTick) {
      errors.upperTick = "Upper tick must be greater than lower tick."
    }
  }

  if (slippage === null || slippage < 0 || slippage > MAX_SLIPPAGE_BPS / 100) {
    errors.slippage = "Use a value from 0% to 5%."
  }
  if (deadline === null || deadline < MIN_DEADLINE_SECONDS || deadline > MAX_DEADLINE_SECONDS) {
    errors.deadline = "Use a deadline between 1 minute and 24 hours."
  }

  return { valid: Object.keys(errors).length === 0, errors }
}

export function buildRebalanceIntent(
  position: RebalancePosition,
  values: RebalanceFormValues,
): RebalanceIntent | null {
  const validation = validateRebalanceForm(values, position.tickSpacing)
  if (!validation.valid) return null

  return {
    kind: "aetherdex.rebalance",
    position,
    newRange: {
      lowerTick: Number(values.lowerTick),
      upperTick: Number(values.upperTick),
    },
    slippageBps: Math.round(Number(values.slippage) * 100),
    deadlineSeconds: Number(values.deadline),
    steps: [
      { kind: "close", description: "Close the selected position." },
      { kind: "collect", description: "Collect tokens and fees from the closed position." },
      { kind: "remint", description: "Re-mint the position in the new tick range." },
    ],
    execution: {
      status: "unavailable",
      reason: "manager-router-not-configured",
    },
  }
}

const BPS = 10_000n
