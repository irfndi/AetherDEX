import { CurrencyAmount, Percent, Token } from "@uniswap/sdk-core"
import { FeeAmount, nearestUsableTick, NonfungiblePositionManager, Pool, Position } from "@uniswap/v3-sdk"
import type { MethodParameters } from "@uniswap/v3-sdk"
import { encodeFunctionData, type Hex } from "viem"

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
  readonly execution: "v3-position-manager-multicall"
  readonly method: MethodParameters
}

export type V3SingleSidedPlan = {
  readonly kind: "v3-single-sided-zap"
  readonly swap: MethodParameters
  readonly mint: V3MintCall
  readonly execution: "requires-private-batched-submission"
}

export type V3SingleSidedZapInput = {
  readonly executor: `0x${string}`
  readonly pool: V3PoolContext
  readonly tokenIn: `0x${string}`
  readonly amountIn: bigint
  readonly swapAmountIn: bigint
  readonly minSwapAmountOut: bigint
  readonly amount0Min: bigint
  readonly amount1Min: bigint
  readonly sqrtPriceLimitX96?: bigint
  readonly tickLower: number
  readonly tickUpper: number
  readonly slippageBps: number
  readonly deadline: bigint
}

export type V3SingleSidedZapCall = {
  readonly kind: "v3-single-sided-zap"
  readonly execution: "v3-zap-executor"
  readonly method: MethodParameters
  readonly amountIn: bigint
  readonly swapAmountIn: bigint
  readonly minSwapAmountOut: bigint
  readonly tickLower: number
  readonly tickUpper: number
}

export type V3SwapQuote = {
  readonly amountOut: bigint
  readonly minAmountOut: bigint
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
  const remint = buildV3MintCall({
    pool: input.pool,
    tickLower: input.newRange.tickLower,
    tickUpper: input.newRange.tickUpper,
    amount0: input.amount0,
    amount1: input.amount1,
    slippageBps: input.slippageBps,
    deadline: input.deadline,
    recipient: input.recipient,
  })
  const method = {
    calldata: encodeFunctionData({
      abi: [
        {
          name: "multicall",
          type: "function",
          stateMutability: "payable",
          inputs: [{ name: "data", type: "bytes[]" }],
          outputs: [{ name: "results", type: "bytes[]" }],
        },
      ] as const,
      functionName: "multicall",
      args: [[exit.calldata as Hex, remint.method.calldata as Hex]],
    }),
    value: "0x00",
  } satisfies MethodParameters
  return {
    kind: "v3-rebalance",
    exit,
    remint,
    execution: "v3-position-manager-multicall",
    method,
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

export function buildV3SingleSidedZapCall(input: V3SingleSidedZapInput): V3SingleSidedZapCall {
  validateRange(input.tickLower, input.tickUpper, input.pool.pool.tickSpacing)
  if (input.executor === "0x0000000000000000000000000000000000000000") {
    throw new Error("V3 zap executor address is required")
  }
  if (input.tokenIn !== input.pool.token0.address && input.tokenIn !== input.pool.token1.address) {
    throw new Error("V3 zap token must belong to the selected pool")
  }
  if (input.amountIn <= 0n || input.swapAmountIn <= 0n || input.swapAmountIn >= input.amountIn) {
    throw new Error("V3 zap amounts are invalid")
  }
  if (input.minSwapAmountOut <= 0n) throw new Error("V3 zap minimum output must be positive")
  const token0 = input.pool.token0.address as `0x${string}`
  const token1 = input.pool.token1.address as `0x${string}`
  return {
    kind: "v3-single-sided-zap",
    execution: "v3-zap-executor",
    method: {
      calldata: encodeFunctionData({
        abi: [
          {
            name: "zap",
            type: "function",
            stateMutability: "nonpayable",
            inputs: [
              {
                name: "params",
                type: "tuple",
                components: [
                  { name: "token0", type: "address" },
                  { name: "token1", type: "address" },
                  { name: "tokenIn", type: "address" },
                  { name: "fee", type: "uint24" },
                  { name: "tickLower", type: "int24" },
                  { name: "tickUpper", type: "int24" },
                  { name: "amountIn", type: "uint256" },
                  { name: "swapAmountIn", type: "uint256" },
                  { name: "minSwapAmountOut", type: "uint256" },
                  { name: "amount0Min", type: "uint256" },
                  { name: "amount1Min", type: "uint256" },
                  { name: "sqrtPriceLimitX96", type: "uint160" },
                  { name: "deadline", type: "uint256" },
                ],
              },
            ],
            outputs: [
              { name: "tokenId", type: "uint256" },
              { name: "liquidity", type: "uint128" },
              { name: "amount0", type: "uint256" },
              { name: "amount1", type: "uint256" },
              { name: "amountOut", type: "uint256" },
            ],
          },
        ] as const,
        functionName: "zap",
        args: [
          {
            token0,
            token1,
            tokenIn: input.tokenIn,
            fee: input.pool.pool.fee,
            tickLower: input.tickLower,
            tickUpper: input.tickUpper,
            amountIn: input.amountIn,
            swapAmountIn: input.swapAmountIn,
            minSwapAmountOut: input.minSwapAmountOut,
            amount0Min: input.amount0Min,
            amount1Min: input.amount1Min,
            sqrtPriceLimitX96: input.sqrtPriceLimitX96 ?? 0n,
            deadline: input.deadline,
          },
        ],
      }),
      value: "0x00",
    },
    amountIn: input.amountIn,
    swapAmountIn: input.swapAmountIn,
    minSwapAmountOut: input.minSwapAmountOut,
    tickLower: input.tickLower,
    tickUpper: input.tickUpper,
  }
}

export async function findV3SwapAmount(input: {
  readonly pool: V3PoolContext
  readonly tickLower: number
  readonly tickUpper: number
  readonly amountIn: bigint
  readonly tokenInIsToken0: boolean
  readonly quote: (amountIn: bigint) => Promise<V3SwapQuote>
}): Promise<{ readonly swapAmountIn: bigint; readonly quote: V3SwapQuote }> {
  if (input.amountIn < 3n) throw new Error("V3 zap amount is too small to split")
  validateRange(input.tickLower, input.tickUpper, input.pool.pool.tickSpacing)
  let low = 1n
  let high = input.amountIn - 1n
  let best: { readonly swapAmountIn: bigint; readonly quote: V3SwapQuote; readonly error: bigint } | null = null

  for (let iteration = 0; iteration < 32 && low <= high; iteration += 1) {
    const swapAmountIn = (low + high) / 2n
    const quote = await input.quote(swapAmountIn)
    const remainingInput = input.amountIn - swapAmountIn
    const amount0 = input.tokenInIsToken0 ? remainingInput : quote.amountOut
    const amount1 = input.tokenInIsToken0 ? quote.amountOut : remainingInput
    const position = Position.fromAmounts({
      pool: input.pool.pool,
      tickLower: input.tickLower,
      tickUpper: input.tickUpper,
      amount0: amount0.toString(),
      amount1: amount1.toString(),
      useFullPrecision: true,
    })
    const consumed = BigInt(
      (input.tokenInIsToken0 ? position.mintAmounts.amount0 : position.mintAmounts.amount1).toString(),
    )
    const error = consumed > remainingInput ? consumed - remainingInput : remainingInput - consumed
    if (best === null || error < best.error) best = { swapAmountIn, quote, error }
    if (consumed < remainingInput) low = swapAmountIn + 1n
    else high = swapAmountIn - 1n
  }
  if (best === null) throw new Error("V3 swap quote search produced no result")
  return { swapAmountIn: best.swapAmountIn, quote: best.quote }
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
