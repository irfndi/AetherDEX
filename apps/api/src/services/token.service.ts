/**
 * AetherDEX Token Service
 * Tracks ERC20 tokens, metadata, verification status
 */

import { Context, Effect, Layer } from "effect"

// --- Types ---

export interface TokenInfo {
  address: string
  symbol: string
  name: string
  decimals: number
  logoUrl: string | null
  isVerified: boolean
  isNative: boolean
  totalSupply: string | null
  createdAt: number
  updatedAt: number
}

export interface TokenSearchOptions {
  query?: string
  verified?: boolean
  limit?: number
}

// --- Service interface ---

export interface TokenService {
  readonly getToken: (address: string) => Effect.Effect<TokenInfo | null>
  readonly listTokens: (options?: TokenSearchOptions) => Effect.Effect<TokenInfo[]>
  readonly searchTokens: (query: string) => Effect.Effect<TokenInfo[]>
  readonly getVerifiedTokens: () => Effect.Effect<TokenInfo[]>
  readonly upsertToken: (
    token: Omit<TokenInfo, "createdAt" | "updatedAt">,
  ) => Effect.Effect<void>
}

// --- Tag ---

export const TokenService = Context.GenericTag<TokenService>("@aetherdex/TokenService")

// --- Default stub implementation (T17 wires real logic) ---

const makeTokenService = (): TokenService => ({
  getToken: (_address: string) => Effect.succeed(null),
  listTokens: (_options?: TokenSearchOptions) => Effect.succeed([]),
  searchTokens: (_query: string) => Effect.succeed([]),
  getVerifiedTokens: () => Effect.succeed([]),
  upsertToken: (_token: Omit<TokenInfo, "createdAt" | "updatedAt">) => Effect.void,
})

// --- Live layer ---

export const TokenServiceLive = Layer.succeed(TokenService, makeTokenService())
