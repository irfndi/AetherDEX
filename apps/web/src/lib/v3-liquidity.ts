import { CurrencyAmount, Percent, Token } from "@uniswap/sdk-core"
import { FeeAmount, nearestUsableTick, NonfungiblePositionManager, Pool, Position } from "@uniswap/v3-sdk"
import type { MethodParameters } from "@uniswap/v3-sdk"

const BPS = 10_000
const FULL_POSITION = new Percent(100, 100)

export type V3Fee = FeeAmount.LOWEST | FeeAmount.LOW | FeeAmount.MEDIUM | FeeAmount.HIGH

export type V3PoolInput = {
  readonly chainId: number
  readonly token0: `0x${string}`
  readonly token1: `0x${string}`
  readonly token0Decimals: number
  readonly token1Decimals: number
  readonly fee: V3Fee
  readonly sqrtPriceX96: bigint
  readonly liquidity: bigint
  readonly currentTick: number
}

export type V3PoolContext = {
  readonly pool: Pool
  readonly token0: Token
  readonly token1: Token
}

export type V3MintInput = {
  readonly pool: V3PoolContext
  readonly tickLower: number
  readonly tickUpper: number
  readonly amount0: bigint
  readonly amount1: bigint
  readonly slippageBps: number
  readonly deadline: bigint
  readonly recipient: `0x${string}`
  readonly createPool?: boolean
}

export type V3MintCall = {
  readonly kind: "v3-mint"
  readonly method: MethodParameters
  readonly tickLower: number
  readonly tickUpper: number
  readonly amount0: bigint
  readonly amount1: bigint
}

export type V3PoolCreateCall = {
  readonly kind: "v3-create-pool"
  readonly method: MethodParameters
}

export type V3RebalanceInput = {
  readonly pool: V3PoolContext
  readonly tokenId: bigint
  readonly currentLiquidity: bigint
  readonly expectedOwed0: bigint
  readonly expectedOwed1: bigint
  readonly recipient: `0x${string}`
  readonly currentRange: {
    readonly tickLower: number
    readonly tickUpper: number
  }
  readonly newRange: {
    readonly tickLower: number
    readonly tickUpper: number
  }
  readonly amount0: bigint
  readonly amount1: bigint
  readonly slippageBps: number
  readonly deadline: bigint
}

export type V3RebalancePlan = {
  readonly kind: "v3-rebalance"
  readonly exit: MethodParameters
  readonly remint: V3MintCall
  readonly execution: "requires-private-batched-submission"
}

export type V3SingleSidedPlan = {
  readonly kind: "v3-single-sided-zap"
  readonly swap: MethodParameters
  readonly mint: V3MintCall
  readonly execution: "requires-private-batched-submission"
}

export function buildV3PoolContext(input: V3PoolInput): V3PoolContext {
  const token0 = new Token(input.chainId, input.token0, input.token0Decimals)
  const token1 = new Token(input.chainId, input.token1, input.token1Decimals)
  return {
    token0,
    token1,
    pool: new Pool(token0, token1, input.fee, input.sqrtPriceX96.toString(), input.liquidity.toString(), input.currentTick),
  }
}

export function snapV3Tick(tick: number, tickSpacing: number): number {
  if (!Number.isSafeInteger(tickSpacing) || tickSpacing <= 0) {
    throw new Error("V3 tick spacing must be a positive integer")
  }
  return nearestUsableTick(tick, tickSpacing)
}

export function buildV3PoolCreateCall(input: V3PoolInput): V3PoolCreateCall {
  return {
    kind: "v3-create-pool",
    method: NonfungiblePositionManager.createCallParameters(buildV3PoolContext(input).pool),
  }
}

export function buildV3MintCall(input: V3MintInput): V3MintCall {
  validateRange(input.tickLower, input.tickUpper, input.pool.pool.tickSpacing)
  const slippageTolerance = toSlippage(input.slippageBps)
  const position = Position.fromAmounts({
    pool: input.pool.pool,
    tickLower: input.tickLower,
    tickUpper: input.tickUpper,
    amount0: input.amount0.toString(),
    amount1: input.amount1.toString(),
    useFullPrecision: true,
  })
  return {
    kind: "v3-mint",
    method: NonfungiblePositionManager.addCallParameters(position, {
      recipient: input.recipient,
      slippageTolerance,
      deadline: input.deadline.toString(),
      createPool: input.createPool ?? false,
    }),
    tickLower: input.tickLower,
    tickUpper: input.tickUpper,
    amount0: input.amount0,
    amount1: input.amount1,
  }
}

export function buildV3RebalancePlan(input: V3RebalanceInput): V3RebalancePlan {
  validateRange(input.currentRange.tickLower, input.currentRange.tickUpper, input.pool.pool.tickSpacing)
  validateRange(input.newRange.tickLower, input.newRange.tickUpper, input.pool.pool.tickSpacing)
  if (input.currentLiquidity <= 0n) throw new Error("V3 current liquidity must be positive")
  const position = new Position({
    pool: input.pool.pool,
    tickLower: input.currentRange.tickLower,
    tickUpper: input.currentRange.tickUpper,
    liquidity: input.currentLiquidity.toString(),
  })
  const exit = NonfungiblePositionManager.removeCallParameters(position, {
    tokenId: input.tokenId.toString(),
    liquidityPercentage: FULL_POSITION,
    slippageTolerance: toSlippage(input.slippageBps),
    deadline: input.deadline.toString(),
    burnToken: true,
    collectOptions: {
      expectedCurrencyOwed0: CurrencyAmount.fromRawAmount(input.pool.token0, input.expectedOwed0.toString()),
      expectedCurrencyOwed1: CurrencyAmount.fromRawAmount(input.pool.token1, input.expectedOwed1.toString()),
      recipient: input.recipient,
    },
  })
  return {
    kind: "v3-rebalance",
    exit,
    remint: buildV3MintCall({
      pool: input.pool,
      tickLower: input.newRange.tickLower,
      tickUpper: input.newRange.tickUpper,
      amount0: input.amount0,
      amount1: input.amount1,
      slippageBps: input.slippageBps,
      deadline: input.deadline,
      recipient: input.recipient,
    }),
    execution: "requires-private-batched-submission",
  }
}

export function buildV3SingleSidedPlan(input: {
  readonly swap: MethodParameters
  readonly mint: V3MintInput
}): V3SingleSidedPlan {
  return {
    kind: "v3-single-sided-zap",
    swap: input.swap,
    mint: buildV3MintCall(input.mint),
    execution: "requires-private-batched-submission",
  }
}

function toSlippage(slippageBps: number): Percent {
  if (!Number.isSafeInteger(slippageBps) || slippageBps < 0 || slippageBps > 500) {
    throw new Error("V3 slippage must be an integer between 0 and 500 bps")
  }
  return new Percent(slippageBps, BPS)
}

function validateRange(tickLower: number, tickUpper: number, tickSpacing: number): void {
  if (!Number.isSafeInteger(tickLower) || !Number.isSafeInteger(tickUpper) || tickLower >= tickUpper) {
    throw new Error("V3 range must contain two ordered integer ticks")
  }
  if (!Number.isSafeInteger(tickSpacing) || tickSpacing <= 0) {
    throw new Error("V3 pool has no valid tick spacing")
  }
  if (tickLower % tickSpacing !== 0 || tickUpper % tickSpacing !== 0) {
    throw new Error(`V3 ticks must be multiples of ${tickSpacing}`)
  }
}
