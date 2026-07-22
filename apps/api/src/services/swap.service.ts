/**
 * AetherDEX Swap Service
 *
 * Phase-0 G2: quotes are computed with the real V4 tick-math engine
 * (`quote-engine.ts`) over on-chain pool state (`ChainStateReader`), and pool
 * metadata is resolved through `PoolService` — no raw D1 access here (G3).
 *
 * Rollback (per plan §9): with `QUOTE_ENGINE_MODE=auto` (default) the service
 * falls back to the legacy constant-product approximation when on-chain reads
 * are unavailable (undeployed / unconfigured, pre-G5). `QUOTE_ENGINE_MODE=v4`
 * makes the V4 path strict; `legacy` forces the old approximation.
 */

import { Context, Effect, Layer } from "effect"
import { type Address, encodeFunctionData, getAddress, type Hex } from "viem"
import { ChainStateReader, OnChainReadError } from "./chain-state-reader"
import { PoolService } from "./pool.service"
import {
  type PoolChainState,
  type PoolKeyParams,
  type QuoteEngineError,
  simulateExactInputSwap,
  ZERO_HOOK_ADDRESS,
} from "./quote-engine"

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

export const SwapService = Context.Service<SwapService>("@aetherdex/SwapService")

// --- Dependencies (env injected via Layer; services via context) ---

export type QuoteEngineMode = "v4" | "legacy" | "auto"

export interface SwapServiceDeps {
  /** AetherRouter address from env (Phase-0 G5 wires the real deployment). */
  routerAddress: string
  /** AetherFactory address from env. */
  factoryAddress: string
  /** Chain id (env CHAIN_ID) — used to derive V4 PoolIds. */
  chainId: number
  /** Quote engine selection (env QUOTE_ENGINE_MODE). */
  mode: QuoteEngineMode
}

export const SwapServiceDeps = Context.Service<SwapServiceDeps>("@aetherdex/SwapServiceDeps")

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

// --- Helpers ---

function sortTokens(a: string, b: string): { token0: string; token1: string } {
  const aLower = a.toLowerCase()
  const bLower = b.toLowerCase()
  if (aLower < bLower) return { token0: a, token1: b }
  if (aLower > bLower) return { token0: b, token1: a }
  throw new Error("Identical tokens not allowed")
}

/** Common V4 fee tiers, tried in order when locating a pool for a token pair. */
const FEE_TIERS = [100, 500, 3000, 10000]

function applySlippage(amountOut: bigint, slippageTolerance: number): bigint {
  const slippageBps = BigInt(Math.max(0, Math.min(Math.floor(slippageTolerance * 10_000), 10_000)))
  return amountOut - (amountOut * slippageBps) / 10_000n
}

function finishQuote(
  poolId: string,
  params: SwapQuoteParams,
  fee: number,
  amountIn: bigint,
  amountOut: bigint,
  priceImpact: number,
): SwapQuote {
  return {
    poolId,
    tokenIn: params.tokenIn,
    tokenOut: params.tokenOut,
    amountIn: amountIn.toString(),
    amountOut: amountOut.toString(),
    minAmountOut: applySlippage(amountOut, params.slippageTolerance).toString(),
    priceImpact,
    fee,
    gasEstimate: "250000", // Conservative estimate for V4 swap
    expiresAt: Date.now() + 60_000,
  }
}

// --- Legacy approximation (rollback path, pre-G2 constant-product) ---

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

interface PoolMeta {
  poolId: string
  token0Address: string
  token1Address: string
  fee: number
  tickSpacing: number
  hookAddress: string | null
  sqrtPriceX96: string
  liquidity: string
}

const makeSwapService = (deps: SwapServiceDeps, pools: PoolService, reader: ChainStateReader): SwapService => {
  const { routerAddress, chainId, mode } = deps

  const resolvePoolMeta = (token0: string, token1: string): Effect.Effect<PoolMeta, SwapQuoteError> =>
    Effect.gen(function* () {
      for (const fee of FEE_TIERS) {
        const pool = yield* pools.getPoolByTokens(token0.toLowerCase(), token1.toLowerCase(), fee)
        if (pool) {
          return {
            poolId: pool.poolId,
            token0Address: pool.token0Address,
            token1Address: pool.token1Address,
            fee: pool.fee,
            tickSpacing: pool.tickSpacing,
            hookAddress: pool.hookAddress,
            sqrtPriceX96: pool.sqrtPriceX96,
            liquidity: pool.liquidity,
          }
        }
      }
      return yield* Effect.fail(new SwapQuoteError("no_pool", `No pool found for ${token0}/${token1}`))
    })

  const quoteV4 = (
    params: SwapQuoteParams,
    amountIn: bigint,
    zeroForOne: boolean,
    meta: PoolMeta,
  ): Effect.Effect<SwapQuote, SwapQuoteError> =>
    Effect.gen(function* () {
      const key: PoolKeyParams = {
        token0: meta.token0Address,
        token1: meta.token1Address,
        fee: meta.fee,
        tickSpacing: meta.tickSpacing,
        hooks: meta.hookAddress ?? ZERO_HOOK_ADDRESS,
      }
      const state: PoolChainState = yield* reader
        .getPoolState(key)
        .pipe(
          Effect.mapError(
            (e) =>
              new SwapQuoteError(
                "no_pool",
                e instanceof OnChainReadError ? `On-chain read failed (${e.reason}): ${e.message}` : String(e),
              ),
          ),
        )

      const result = yield* Effect.tryPromise({
        try: () => simulateExactInputSwap({ chainId, key, state, zeroForOne, amountIn }),
        catch: (e) => {
          const err = e as QuoteEngineError
          if (err?.reason === "no_liquidity") {
            return new SwapQuoteError("insufficient_liquidity", err.message)
          }
          if (err?.reason === "invalid_amount") {
            return new SwapQuoteError("invalid_amount", err.message)
          }
          return new SwapQuoteError("no_pool", err?.message ?? String(e))
        },
      })

      if (result.amountOut <= 0n) {
        return yield* Effect.fail(new SwapQuoteError("insufficient_liquidity", "Swap would yield 0 output"))
      }

      return finishQuote(meta.poolId, params, meta.fee, amountIn, result.amountOut, result.priceImpact)
    })

  const quoteLegacy = (
    params: SwapQuoteParams,
    amountIn: bigint,
    meta: PoolMeta,
  ): Effect.Effect<SwapQuote, SwapQuoteError> =>
    Effect.gen(function* () {
      // Legacy approximation: treats in-range liquidity as a constant-product
      // reserve. Wrong for CL across tick crossings — kept only as the
      // pre-G5/unconfigured rollback path (QUOTE_ENGINE_MODE=auto|legacy).
      const liquidity = BigInt(meta.liquidity)
      if (liquidity <= 0n) {
        return yield* Effect.fail(new SwapQuoteError("insufficient_liquidity", "Pool has no liquidity"))
      }
      const amountOut = calculateConstantProductQuote(amountIn, liquidity, liquidity, meta.fee)
      if (amountOut <= 0n) {
        return yield* Effect.fail(new SwapQuoteError("insufficient_liquidity", "Swap would yield 0 output"))
      }
      const priceImpact = calculatePriceImpact(amountIn, amountOut, liquidity, liquidity)
      return finishQuote(meta.poolId, params, meta.fee, amountIn, amountOut, priceImpact)
    })

  const getQuote = (params: SwapQuoteParams): Effect.Effect<SwapQuote, SwapQuoteError> =>
    Effect.gen(function* () {
      if (!/^\d+$/.test(params.amountIn)) {
        return yield* Effect.fail(new SwapQuoteError("invalid_amount", "amountIn must be a positive integer string"))
      }
      const amountIn = BigInt(params.amountIn)
      if (amountIn <= 0n) {
        return yield* Effect.fail(new SwapQuoteError("invalid_amount", "amountIn must be positive"))
      }

      const { token0 } = sortTokens(params.tokenIn, params.tokenOut)
      const zeroForOne = params.tokenIn.toLowerCase() === token0.toLowerCase()
      const meta = yield* resolvePoolMeta(token0, params.tokenOut === token0 ? params.tokenIn : params.tokenOut)

      if (mode === "legacy") {
        return yield* quoteLegacy(params, amountIn, meta)
      }

      return yield* quoteV4(params, amountIn, zeroForOne, meta).pipe(
        Effect.catch((err) => {
          // Rollback path: in auto mode, degrade to the legacy approximation
          // when the V4 path cannot read on-chain state (e.g. undeployed pre-G5).
          if (mode === "auto") {
            return quoteLegacy(params, amountIn, meta)
          }
          return Effect.fail(err)
        }),
      )
    })

  const buildCalldata = (
    quote: SwapQuote,
    recipient: string,
  ): Effect.Effect<{ to: string; data: string; value: string }, never, never> =>
    Effect.gen(function* () {
      if (!quote.poolId || quote.poolId === `0x${"0".repeat(64)}`) {
        return yield* Effect.fail(new SwapQuoteError("invalid_amount", "Invalid poolId — get a quote first"))
      }
      if (!recipient?.startsWith("0x")) {
        return yield* Effect.fail(new SwapQuoteError("invalid_amount", "Invalid recipient address"))
      }

      const pool = yield* pools.getPool(quote.poolId)
      if (!pool) {
        return yield* Effect.fail(new SwapQuoteError("no_pool", `Pool ${quote.poolId} not found`))
      }

      const zeroForOne = quote.tokenIn.toLowerCase() === pool.token0Address.toLowerCase()
      const hookAddress = (pool.hookAddress ?? ZERO_HOOK_ADDRESS) as Address

      const params = {
        poolKey: {
          currency0: getAddress(pool.token0Address),
          currency1: getAddress(pool.token1Address),
          fee: pool.fee,
          tickSpacing: pool.tickSpacing,
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
    }).pipe(Effect.catch((err) => Effect.die(err)))

  return {
    getQuote,
    buildCalldata,
  }
}

export const SwapServiceLive = Layer.effect(
  SwapService,
  Effect.gen(function* () {
    const deps = yield* SwapServiceDeps
    const pools = yield* PoolService
    const reader = yield* ChainStateReader
    return makeSwapService(deps, pools, reader)
  }),
)
