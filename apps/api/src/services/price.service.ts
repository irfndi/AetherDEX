/**
 * AetherDEX Price Service
 * Aggregates price feeds from on-chain reads (Pyth), KV cache, and DexScreener
 */

import { Context, Effect, Layer } from "effect"

// --- Types ---

export interface PriceData {
  tokenAddress: string
  priceUsd: number
  source: "pyth" | "chainlink" | "dexscreener" | "cache"
  confidence?: number
  updatedAt: number
}

// --- Errors ---

export class PriceFetchError {
  readonly _tag = "PriceFetchError"
  constructor(
    readonly tokenAddress: string,
    readonly cause: string,
  ) {}
}

// --- Service interface ---

export interface PriceService {
  readonly getPrice: (tokenAddress: string) => Effect.Effect<PriceData, PriceFetchError>
  readonly getPrices: (tokenAddresses: string[]) => Effect.Effect<PriceData[], PriceFetchError>
  readonly refreshPrice: (tokenAddress: string) => Effect.Effect<PriceData, PriceFetchError>
}

// --- Tag ---

export const PriceService = Context.GenericTag<PriceService>("@aetherdex/PriceService")

// --- Default stub implementation (T17 wires real logic) ---

const makePriceService = (): PriceService => ({
  getPrice: (tokenAddress: string): Effect.Effect<PriceData, PriceFetchError> =>
    Effect.gen(function* () {
      // Stub: cache-first lookup, fall back to on-chain read (T17)
      return {
        tokenAddress,
        priceUsd: 0,
        source: "cache",
        updatedAt: Date.now(),
      }
    }),

  getPrices: (tokenAddresses: string[]): Effect.Effect<PriceData[], PriceFetchError> =>
    Effect.gen(function* () {
      return tokenAddresses.map((addr) => ({
        tokenAddress: addr,
        priceUsd: 0,
        source: "cache" as const,
        updatedAt: Date.now(),
      }))
    }),

  refreshPrice: (tokenAddress: string): Effect.Effect<PriceData, PriceFetchError> =>
    Effect.gen(function* () {
      return {
        tokenAddress,
        priceUsd: 0,
        source: "dexscreener",
        updatedAt: Date.now(),
      }
    }),
})

// --- Live layer ---

export const PriceServiceLive = Layer.succeed(PriceService, makePriceService())
