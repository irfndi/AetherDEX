// @ts-nocheck
/**
 * AetherDEX Token Service
 * Tracks ERC20 tokens, metadata, verification status
 */

import { SqlClient } from "@effect/sql"
import { Context, Effect, Layer } from "effect"
import { rowToToken } from "../db/schema"

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
  readonly upsertToken: (token: Omit<TokenInfo, "createdAt" | "updatedAt">) => Effect.Effect<void>
}

// --- Tag ---

export const TokenService = Context.GenericTag<TokenService>("@aetherdex/TokenService")

// --- D1-backed implementation ---

const makeTokenService = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient

  const getToken = (address: string): Effect.Effect<TokenInfo | null> =>
    Effect.gen(function* () {
      const rows = yield* sql`SELECT * FROM tokens WHERE address = ${address}`
      if (rows.length === 0) return null
      return rowToToken(rows[0] as Record<string, unknown>)
    })

  const listTokens = (options?: TokenSearchOptions): Effect.Effect<TokenInfo[]> =>
    Effect.gen(function* () {
      const limit = Math.min(options?.limit ?? 100, 500)
      const verified = options?.verified
      const search = options?.query

      let rows: Record<string, unknown>[]

      if (verified === true && search && search.length >= 2) {
        const searchPattern = `%${search.toLowerCase()}%`
        rows = yield* sql`
          SELECT * FROM tokens
          WHERE is_verified = 1 AND (LOWER(symbol) LIKE ${searchPattern} OR LOWER(name) LIKE ${searchPattern})
          ORDER BY symbol ASC
          LIMIT ${limit}
        `
      } else if (verified === true) {
        rows = yield* sql`
          SELECT * FROM tokens
          WHERE is_verified = 1
          ORDER BY symbol ASC
          LIMIT ${limit}
        `
      } else if (search && search.length >= 2) {
        const searchPattern = `%${search.toLowerCase()}%`
        rows = yield* sql`
          SELECT * FROM tokens
          WHERE LOWER(symbol) LIKE ${searchPattern} OR LOWER(name) LIKE ${searchPattern}
          ORDER BY is_verified DESC, symbol ASC
          LIMIT ${limit}
        `
      } else {
        rows = yield* sql`
          SELECT * FROM tokens
          ORDER BY is_verified DESC, symbol ASC
          LIMIT ${limit}
        `
      }

      return rows.map((r) => rowToToken(r))
    })

  const searchTokens = (query: string): Effect.Effect<TokenInfo[]> =>
    Effect.gen(function* () {
      if (query.length < 2) return []
      const searchPattern = `%${query.toLowerCase()}%`
      const rows = yield* sql`
        SELECT * FROM tokens
        WHERE LOWER(symbol) LIKE ${searchPattern} OR LOWER(name) LIKE ${searchPattern}
        ORDER BY is_verified DESC, symbol ASC
        LIMIT 50
      `
      return rows.map((r) => rowToToken(r))
    })

  const getVerifiedTokens = (): Effect.Effect<TokenInfo[]> =>
    Effect.gen(function* () {
      const rows = yield* sql`
        SELECT * FROM tokens
        WHERE is_verified = 1
        ORDER BY symbol ASC
        LIMIT 100
      `
      return rows.map((r) => rowToToken(r))
    })

  const upsertToken = (token: Omit<TokenInfo, "createdAt" | "updatedAt">): Effect.Effect<void> =>
    Effect.gen(function* () {
      yield* sql`
        INSERT INTO tokens (address, symbol, name, decimals, logo_url, is_verified, is_native, total_supply, created_at, updated_at)
        VALUES (${token.address}, ${token.symbol}, ${token.name}, ${token.decimals}, ${token.logoUrl}, ${token.isVerified ? 1 : 0}, ${token.isNative ? 1 : 0}, ${token.totalSupply}, ${Date.now()}, ${Date.now()})
        ON CONFLICT(address) DO UPDATE SET
          symbol = excluded.symbol,
          name = excluded.name,
          decimals = excluded.decimals,
          logo_url = excluded.logo_url,
          is_verified = excluded.is_verified,
          total_supply = excluded.total_supply,
          updated_at = excluded.updated_at
      `
    })

  return TokenService.of({
    getToken,
    listTokens,
    searchTokens,
    getVerifiedTokens,
    upsertToken,
  })
})

// --- Live layer (requires SqlClient.SqlClient from D1) ---

export const TokenServiceLive = Layer.effect(TokenService, makeTokenService)
