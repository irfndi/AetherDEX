/**
 * AetherDEX Swap Service
 * Quote generation, slippage protection, route optimization
 */

import { Context, Effect, Layer } from "effect"

// --- Types ---

export interface SwapQuote {
  poolId: string
  tokenIn: string
  tokenOut: string
  amountIn: string
  amountOut: string
  /** Minimum output after slippage */
  minAmountOut: string
  /** Effective price impact = amountIn / amountOut vs market price */
  priceImpact: number // 0-1, e.g. 0.005 = 0.5%
  /** Fee tier of the pool (e.g. 3000 = 0.3%) */
  fee: number
  /** Gas estimate (rough, in wei) */
  gasEstimate: string
  /** Quote expiry (Unix ms) */
  expiresAt: number
}

export interface SwapQuoteParams {
  tokenIn: string
  tokenOut: string
  amountIn: string
  slippageTolerance: number // 0.01 = 1%
  deadline?: number
}

// --- Errors ---

export class SwapQuoteError {
  readonly _tag = "SwapQuoteError"
  constructor(
    readonly reason: "no_pool" | "insufficient_liquidity" | "invalid_amount" | "expired",
    readonly message: string,
  ) {}
}

// --- Service interface ---

export interface SwapService {
  readonly getQuote: (params: SwapQuoteParams) => Effect.Effect<SwapQuote, SwapQuoteError>
  readonly buildCalldata: (
    quote: SwapQuote,
    recipient: string,
  ) => Effect.Effect<{ to: string; data: string; value: string }>
}

// --- Tag ---

export const SwapService = Context.GenericTag<SwapService>("@aetherdex/SwapService")

// --- Default stub implementation (T17 wires V4 PoolManager quote logic) ---

const makeSwapService = (): SwapService => ({
  getQuote: (params: SwapQuoteParams): Effect.Effect<SwapQuote, SwapQuoteError> =>
    Effect.gen(function* () {
      return {
        poolId: "",
        tokenIn: params.tokenIn,
        tokenOut: params.tokenOut,
        amountIn: params.amountIn,
        amountOut: "0",
        minAmountOut: "0",
        priceImpact: 0,
        fee: 3000,
        gasEstimate: "200000",
        expiresAt: Date.now() + 60_000,
      }
    }),

  buildCalldata: (quote: SwapQuote, _recipient: string) =>
    Effect.succeed({
      to: "",
      data: "0x",
      value: "0",
    }),
})

// --- Live layer ---

export const SwapServiceLive = Layer.succeed(SwapService, makeSwapService())
