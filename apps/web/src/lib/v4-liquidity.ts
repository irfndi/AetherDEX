import { Token } from "@uniswap/sdk-core"
import { Pool, Position } from "@uniswap/v4-sdk"
import { encodeFunctionData, encodePacked, keccak256, type Hex } from "viem"

const BPS = 10_000n
const MAX_UINT128 = 2n ** 128n - 1n
const MAX_INT128 = 2n ** 127n - 1n

const AETHER_POSITION_MANAGER_ABI = [
  {
    name: "mintPositionSingleSided",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      {
        name: "params",
        type: "tuple",
        components: [
          {
            name: "poolKey",
            type: "tuple",
            components: [
              { name: "currency0", type: "address" },
              { name: "currency1", type: "address" },
              { name: "fee", type: "uint24" },
              { name: "tickSpacing", type: "int24" },
              { name: "hooks", type: "address" },
            ],
          },
          { name: "tickLower", type: "int24" },
          { name: "tickUpper", type: "int24" },
          { name: "liquidity", type: "uint128" },
          { name: "zeroForOne", type: "bool" },
          { name: "amountIn", type: "uint128" },
          { name: "swapAmountIn", type: "uint128" },
          { name: "minSwapAmountOut", type: "uint128" },
          { name: "minAmount0", type: "uint256" },
          { name: "minAmount1", type: "uint256" },
          { name: "recipient", type: "address" },
          { name: "deadline", type: "uint256" },
          { name: "hookData", type: "bytes" },
        ],
      },
    ],
    outputs: [
      { name: "tokenId", type: "uint256" },
      { name: "amount0", type: "uint256" },
      { name: "amount1", type: "uint256" },
      { name: "amountOut", type: "uint256" },
    ],
  },
] as const

export type V4LiquidityPoolInput = {
  readonly chainId: number
  readonly token0: `0x${string}`
  readonly token1: `0x${string}`
  readonly token0Decimals: number
  readonly token1Decimals: number
  readonly fee: number
  readonly tickSpacing: number
  readonly hooks: `0x${string}`
  readonly sqrtPriceX96: bigint
  readonly liquidity: bigint
  readonly currentTick: number
}

export type V4PoolKeyInput = Pick<
  V4LiquidityPoolInput,
  "chainId" | "token0" | "token1" | "token0Decimals" | "token1Decimals" | "fee" | "tickSpacing" | "hooks"
>

export function getV4PoolId(input: V4PoolKeyInput): `0x${string}` {
  const token0 = new Token(input.chainId, input.token0, input.token0Decimals)
  const token1 = new Token(input.chainId, input.token1, input.token1Decimals)
  return Pool.getPoolId(token0, token1, input.fee, input.tickSpacing, input.hooks) as `0x${string}`
}

export type V4SingleSidedCallInput = {
  readonly pool: V4LiquidityPoolInput
  readonly tickLower: number
  readonly tickUpper: number
  readonly zeroForOne: boolean
  readonly amountIn: bigint
  readonly swapAmountIn: bigint
  readonly quotedAmountOut: bigint
  readonly minSwapAmountOut: bigint
  readonly slippageBps: number
  readonly deadline: bigint
  readonly recipient: `0x${string}`
  readonly hookData?: Hex
}

export type V4SingleSidedCall = {
  readonly kind: "v4-single-sided-zap"
  readonly calldata: Hex
  readonly value: Hex
  readonly deadline: bigint
  readonly liquidityDelta: bigint
  readonly expectedAmount0: bigint
  readonly expectedAmount1: bigint
}

export type V4SwapQuote = {
  readonly amountOut: bigint
  readonly minAmountOut: bigint
}

export function buildV4SingleSidedCall(input: V4SingleSidedCallInput): V4SingleSidedCall {
  validateInput(input)
  const sdkPool = createV4Pool(input.pool)
  const remainingInput = input.amountIn - input.swapAmountIn
  const amount0 = input.zeroForOne ? remainingInput : input.quotedAmountOut
  const amount1 = input.zeroForOne ? input.quotedAmountOut : remainingInput
  const position = Position.fromAmounts({
    pool: sdkPool,
    tickLower: input.tickLower,
    tickUpper: input.tickUpper,
    amount0: amount0.toString(),
    amount1: amount1.toString(),
    useFullPrecision: true,
  })
  const liquidityDelta = BigInt(position.liquidity.toString())
  if (liquidityDelta <= 0n || liquidityDelta > MAX_INT128) throw new Error("V4 liquidity delta is out of range")
  const slippageFactor = BPS - BigInt(input.slippageBps)
  const expectedAmount0 = BigInt(position.mintAmounts.amount0.toString())
  const expectedAmount1 = BigInt(position.mintAmounts.amount1.toString())
  const params = {
    poolKey: {
      currency0: input.pool.token0,
      currency1: input.pool.token1,
      fee: input.pool.fee,
      tickSpacing: input.pool.tickSpacing,
      hooks: input.pool.hooks,
    },
    tickLower: input.tickLower,
    tickUpper: input.tickUpper,
    liquidity: liquidityDelta,
    zeroForOne: input.zeroForOne,
    amountIn: input.amountIn,
    swapAmountIn: input.swapAmountIn,
    minSwapAmountOut: input.minSwapAmountOut,
    minAmount0: (expectedAmount0 * slippageFactor) / BPS,
    minAmount1: (expectedAmount1 * slippageFactor) / BPS,
    recipient: input.recipient,
    deadline: input.deadline,
    hookData: input.hookData ?? "0x",
  } as const
  return {
    kind: "v4-single-sided-zap",
    calldata: encodeFunctionData({
      abi: AETHER_POSITION_MANAGER_ABI,
      functionName: "mintPositionSingleSided",
      args: [params],
    }),
    value: "0x0",
    deadline: input.deadline,
    liquidityDelta,
    expectedAmount0,
    expectedAmount1,
  }
}

export async function findV4SwapAmount(input: {
  readonly pool: V4LiquidityPoolInput
  readonly tickLower: number
  readonly tickUpper: number
  readonly zeroForOne: boolean
  readonly amountIn: bigint
  readonly quote: (amountIn: bigint) => Promise<V4SwapQuote>
}): Promise<{ readonly swapAmountIn: bigint; readonly quote: V4SwapQuote }> {
  if (input.amountIn < 3n) throw new Error("V4 single-sided amount is too small to split")
  const sdkPool = createV4Pool(input.pool)
  let low = 1n
  let high = input.amountIn - 1n
  let best: { readonly swapAmountIn: bigint; readonly quote: V4SwapQuote; readonly error: bigint } | null = null

  for (let iteration = 0; iteration < 12 && low <= high; iteration += 1) {
    const swapAmountIn = (low + high) / 2n
    const quote = await input.quote(swapAmountIn)
    const remainingInput = input.amountIn - swapAmountIn
    const amount0 = input.zeroForOne ? remainingInput : quote.amountOut
    const amount1 = input.zeroForOne ? quote.amountOut : remainingInput
    const position = Position.fromAmounts({
      pool: sdkPool,
      tickLower: input.tickLower,
      tickUpper: input.tickUpper,
      amount0: amount0.toString(),
      amount1: amount1.toString(),
      useFullPrecision: true,
    })
    const consumed = BigInt(
      (input.zeroForOne ? position.mintAmounts.amount0 : position.mintAmounts.amount1).toString(),
    )
    const error = consumed > remainingInput ? consumed - remainingInput : remainingInput - consumed
    if (best === null || error < best.error) best = { swapAmountIn, quote, error }
    if (consumed < remainingInput) low = swapAmountIn + 1n
    else high = swapAmountIn - 1n
  }
  if (best === null) throw new Error("V4 single-sided quote search produced no candidate")
  return best
}

function createV4Pool(input: V4LiquidityPoolInput): Pool {
  const token0 = new Token(input.chainId, input.token0, input.token0Decimals)
  const token1 = new Token(input.chainId, input.token1, input.token1Decimals)
  return new Pool(
    token0,
    token1,
    input.fee,
    input.tickSpacing,
    input.hooks,
    input.sqrtPriceX96.toString(),
    input.liquidity.toString(),
    input.currentTick,
  )
}

function validateInput(input: V4SingleSidedCallInput): void {
  if (!Number.isSafeInteger(input.tickLower) || !Number.isSafeInteger(input.tickUpper) || input.tickLower >= input.tickUpper) {
    throw new Error("V4 range must contain two ordered integer ticks")
  }
  if (input.tickLower % input.pool.tickSpacing !== 0 || input.tickUpper % input.pool.tickSpacing !== 0) {
    throw new Error(`V4 ticks must be multiples of ${input.pool.tickSpacing}`)
  }
  if (input.amountIn <= 0n || input.swapAmountIn <= 0n || input.swapAmountIn > input.amountIn) {
    throw new Error("V4 single-sided amounts are invalid")
  }
  if (input.quotedAmountOut <= 0n || input.minSwapAmountOut <= 0n || input.minSwapAmountOut > input.quotedAmountOut) {
    throw new Error("V4 swap quote is invalid")
  }
  if (!Number.isSafeInteger(input.slippageBps) || input.slippageBps < 0 || input.slippageBps > 500) {
    throw new Error("V4 slippage must be an integer between 0 and 500 bps")
  }
  if (input.amountIn > MAX_UINT128 || input.swapAmountIn > MAX_UINT128 || input.minSwapAmountOut > MAX_UINT128) {
    throw new Error("V4 single-sided amount exceeds uint128")
  }
  if (input.pool.tickSpacing <= 0) throw new Error("V4 tick spacing must be positive")
  if (input.pool.sqrtPriceX96 <= 0n || input.pool.liquidity <= 0n) throw new Error("V4 pool state is invalid")
  if (input.deadline <= 0n) throw new Error("V4 deadline must be positive")
  if (input.salt === `0x${"00".repeat(32)}`) throw new Error("V4 position salt must be unique")
}

export function deriveV4PositionSalt(owner: `0x${string}`, nonce: bigint): Hex {
  return keccak256(encodePacked(["address", "uint256"], [owner, nonce]))
}
