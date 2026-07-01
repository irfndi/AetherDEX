import { Context, Effect, Layer } from "effect"
import { type Address, encodeFunctionData, getAddress, type Hex } from "viem"

// --- Types ---

export interface SwapQuote {
  poolId: string
  tokenIn: string
  tokenOut: string
  amountIn: string
  amountOut: string
  minAmountOut: string
  priceImpact: number
  fee: number
  gasEstimate: string
  expiresAt: number
}

export interface SwapQuoteParams {
  tokenIn: string
  tokenOut: string
  amountIn: string
  slippageTolerance: number
  deadline?: number
}

export class SwapQuoteError {
  readonly _tag = "SwapQuoteError"
  constructor(
    readonly reason: "no_pool" | "insufficient_liquidity" | "invalid_amount" | "expired",
    readonly message: string,
  ) {}
}

export interface SwapService {
  readonly getQuote: (params: SwapQuoteParams) => Effect.Effect<SwapQuote, SwapQuoteError>
  readonly buildCalldata: (
    quote: SwapQuote,
    recipient: string,
  ) => Effect.Effect<{ to: string; data: string; value: string }>
}

export const SwapService = Context.GenericTag<SwapService>("@aetherdex/SwapService")

// --- Dependencies (D1 + env injected via Layer) ---

export interface SwapServiceDeps {
  db: D1Database
  /** AetherRouter address from env, or hardcoded default for local dev */
  routerAddress: string
  /** AetherFactory address from env, or hardcoded default */
  factoryAddress: string
}

export const SwapServiceDeps = Context.GenericTag<SwapServiceDeps>("@aetherdex/SwapServiceDeps")

// --- AetherRouter ABI (only the function we need) ---

const AETHER_ROUTER_ABI = [
  {
    name: "swapExactTokensForTokens",
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
          { name: "zeroForOne", type: "bool" },
          { name: "amountIn", type: "uint128" },
          { name: "minAmountOut", type: "uint128" },
          { name: "deadline", type: "uint256" },
          { name: "hookData", type: "bytes" },
        ],
      },
    ],
    outputs: [{ name: "amountOut", type: "uint256" }],
  },
] as const

// --- AetherFactory ABI (for pool lookup) ---

const _AETHER_FACTORY_ABI = [
  {
    name: "getPool",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "poolId", type: "bytes32" }],
    outputs: [
      {
        name: "",
        type: "tuple",
        components: [
          { name: "currency0", type: "address" },
          { name: "currency1", type: "address" },
          { name: "fee", type: "uint24" },
          { name: "tickSpacing", type: "int24" },
          { name: "hooks", type: "address" },
        ],
      },
    ],
  },
] as const

// --- Helpers ---

function sortTokens(a: string, b: string): { token0: string; token1: string } {
  const aLower = a.toLowerCase()
  const bLower = b.toLowerCase()
  if (aLower < bLower) return { token0: a, token1: b }
  if (aLower > bLower) return { token0: b, token1: a }
  throw new Error("Identical tokens not allowed")
}

/**
 * Constant-product AMM quote calculation.
 *
 * Simplified approximation of V4 concentrated liquidity math.
 * Real V4 quotes require tick math (TickMath.getSqrtPriceAtTick, LiquidityAmounts.getAmount0Delta, etc.)
 * Formula: amountOut = (amountIn * (10000-feeBps) * reserveOut) / (reserveIn * 10000 + amountIn * (10000-feeBps))
 */
function calculateConstantProductQuote(
  amountIn: bigint,
  reserveIn: bigint,
  reserveOut: bigint,
  feeBps: number,
): bigint {
  if (amountIn <= 0n) return 0n
  if (reserveIn <= 0n || reserveOut <= 0n) return 0n
  const feeNumerator = BigInt(10_000 - feeBps)
  const amountInWithFee = amountIn * feeNumerator
  const numerator = amountInWithFee * reserveOut
  const denominator = reserveIn * 10_000n + amountInWithFee
  return numerator / denominator
}

function calculatePriceImpact(amountIn: bigint, amountOut: bigint, reserveIn: bigint, reserveOut: bigint): number {
  if (amountIn <= 0n || amountOut <= 0n) return 0
  if (reserveIn <= 0n || reserveOut <= 0n) return 0
  const effectivePrice = Number(amountIn) / Number(amountOut)
  const marketPrice = Number(reserveIn) / Number(reserveOut)
  if (effectivePrice <= 0) return 0
  return Math.max(0, 1 - marketPrice / effectivePrice)
}

// --- Live implementation ---

const makeSwapService = (deps: SwapServiceDeps): SwapService => {
  const { db, routerAddress } = deps

  const getQuote = (params: SwapQuoteParams): Effect.Effect<SwapQuote, SwapQuoteError> =>
    Effect.gen(function* () {
      // 1. Validate inputs
      if (!/^\d+$/.test(params.amountIn)) {
        return yield* Effect.fail(new SwapQuoteError("invalid_amount", "amountIn must be a positive integer string"))
      }
      const amountIn = BigInt(params.amountIn)
      if (amountIn <= 0n) {
        return yield* Effect.fail(new SwapQuoteError("invalid_amount", "amountIn must be positive"))
      }

      // 2. Sort tokens to match V4 PoolKey convention
      const { token0, token1 } = sortTokens(params.tokenIn, params.tokenOut)
      const zeroForOne = params.tokenIn.toLowerCase() === token0.toLowerCase()

      // 3. Look up pool from D1
      // We try common fee tiers in order: 100 (0.01%), 500 (0.05%), 3000 (0.3%), 10000 (1%)
      const feeTiers = [100, 500, 3000, 10000]
      const _tickSpacing = 60

      let pool: {
        pool_id: string
        sqrt_price_x96: string
        liquidity: string
        fee: number
      } | null = null

      for (const fee of feeTiers) {
        const result = yield* Effect.tryPromise({
          try: async () => {
            const row = await db
              .prepare(
                "SELECT pool_id, sqrt_price_x96, liquidity, fee FROM pools WHERE token0_address = ? AND token1_address = ? AND fee = ?",
              )
              .bind(token0.toLowerCase(), token1.toLowerCase(), fee)
              .first<{
                pool_id: string
                sqrt_price_x96: string
                liquidity: string
                fee: number
              }>()
            return row
          },
          catch: (e) => {
            throw new SwapQuoteError("no_pool", `D1 query failed: ${e instanceof Error ? e.message : String(e)}`)
          },
        })
        if (result) {
          pool = { ...result, fee }
          break
        }
      }

      if (!pool) {
        return yield* Effect.fail(
          new SwapQuoteError("no_pool", `No pool found for ${params.tokenIn}/${params.tokenOut}`),
        )
      }

      // 4. Calculate reserves from sqrtPriceX96 and liquidity
      // For V4 concentrated liquidity, reserves are:
      //   amount0 = liquidity * (1/sqrtPriceLower - 1/sqrtPriceUpper)
      //   amount1 = liquidity * (sqrtPriceUpper - sqrtPriceLower)
      // Simplified: we use the liquidity value as a proxy for both reserves.
      // This is an approximation — real V4 requires tick math.
      // For a constant-product approximation, we treat liquidity as the reserve.
      const liquidity = BigInt(pool.liquidity)
      if (liquidity <= 0n) {
        return yield* Effect.fail(new SwapQuoteError("insufficient_liquidity", "Pool has no liquidity"))
      }

      // Use liquidity as both reserves for constant-product approximation
      const reserveIn = zeroForOne ? liquidity : liquidity
      const reserveOut = zeroForOne ? liquidity : liquidity

      // 5. Calculate amountOut using constant-product formula
      const amountOut = calculateConstantProductQuote(amountIn, reserveIn, reserveOut, pool.fee)

      if (amountOut <= 0n) {
        return yield* Effect.fail(new SwapQuoteError("insufficient_liquidity", "Swap would yield 0 output"))
      }

      // 6. Calculate price impact
      const priceImpact = calculatePriceImpact(amountIn, amountOut, reserveIn, reserveOut)

      // 7. Calculate minAmountOut with slippage
      const slippageBps = Math.floor(params.slippageTolerance * 10_000)
      const minAmountOut = amountOut - (amountOut * BigInt(slippageBps)) / 10_000n

      // 8. Calculate deadline (20 minutes from now if not provided)
      const _deadline = params.deadline ?? Math.floor(Date.now() / 1000) + 1200

      return {
        poolId: pool.pool_id,
        tokenIn: params.tokenIn,
        tokenOut: params.tokenOut,
        amountIn: params.amountIn,
        amountOut: amountOut.toString(),
        minAmountOut: minAmountOut.toString(),
        priceImpact,
        fee: pool.fee,
        gasEstimate: "250000", // Conservative estimate for V4 swap
        expiresAt: Date.now() + 60_000,
      }
    })

  const buildCalldata = (
    quote: SwapQuote,
    recipient: string,
  ): Effect.Effect<{ to: string; data: string; value: string }, never, never> =>
    Effect.gen(function* () {
      // Validate inputs
      if (!quote.poolId || quote.poolId === `0x${"0".repeat(64)}`) {
        return yield* Effect.fail(new SwapQuoteError("invalid_amount", "Invalid poolId — get a quote first"))
      }
      if (!recipient?.startsWith("0x")) {
        return yield* Effect.fail(new SwapQuoteError("invalid_amount", "Invalid recipient address"))
      }

      // Parse poolId to extract sorted tokens, fee, tickSpacing, hook
      // For now, we read from D1 to reconstruct the PoolKey
      const poolRow = yield* Effect.tryPromise({
        try: () =>
          db
            .prepare(
              "SELECT token0_address, token1_address, fee, tick_spacing, hook_address FROM pools WHERE pool_id = ?",
            )
            .bind(quote.poolId)
            .first<{
              token0_address: string
              token1_address: string
              fee: number
              tick_spacing: number
              hook_address: string | null
            }>(),
        catch: (e) => {
          throw new SwapQuoteError("no_pool", `D1 query failed: ${e instanceof Error ? e.message : String(e)}`)
        },
      })

      if (!poolRow) {
        return yield* Effect.fail(new SwapQuoteError("no_pool", `Pool ${quote.poolId} not found`))
      }

      const zeroForOne = quote.tokenIn.toLowerCase() === poolRow.token0_address.toLowerCase()
      const hookAddress = (poolRow.hook_address ?? "0x0000000000000000000000000000000000000000") as Address

      // Encode the swapExactTokensForTokens function call
      const params = {
        poolKey: {
          currency0: getAddress(poolRow.token0_address),
          currency1: getAddress(poolRow.token1_address),
          fee: poolRow.fee,
          tickSpacing: poolRow.tick_spacing,
          hooks: getAddress(hookAddress),
        },
        zeroForOne,
        amountIn: BigInt(quote.amountIn),
        minAmountOut: BigInt(quote.minAmountOut),
        deadline: BigInt(Math.floor(Date.now() / 1000) + 1200),
        hookData: "0x" as Hex,
      }

      const data = encodeFunctionData({
        abi: AETHER_ROUTER_ABI,
        functionName: "swapExactTokensForTokens",
        args: [params],
      })

      return {
        to: routerAddress,
        data,
        value: "0", // ERC-20 swap, no ETH value
      }
    }).pipe(Effect.catchAll((err) => Effect.die(err)))

  return {
    getQuote,
    buildCalldata,
  }
}

export const SwapServiceLive = Layer.effect(
  SwapService,
  Effect.gen(function* () {
    const deps = yield* SwapServiceDeps
    return makeSwapService(deps)
  }),
)
