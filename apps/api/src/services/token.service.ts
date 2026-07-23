/**
 * AetherDEX Token Service
 * Tracks ERC20 tokens, metadata, verification status
 */

import { Context, Effect, Layer } from "effect"
import { SqlClient } from "effect/unstable/sql"
import { rowToToken } from "../db/schema"

// --- Types ---

export interface TokenInfo {
  chainId: number
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

// --- Errors ---

/** Raised when a token list read from D1 fails, so HTTP callers return 500 instead of 200 `[]`. */
export class TokenListError {
  readonly _tag = "TokenListError"
  constructor(readonly cause: string) {}
}

/** Raised when a single-token read from D1 fails, so HTTP callers return 500 instead of 404 for a valid address. */
export class TokenReadError {
  readonly _tag = "TokenReadError"
  constructor(readonly cause: string) {}
}

// --- Service interface ---

export interface TokenService {
  readonly getToken: (address: string) => Effect.Effect<TokenInfo | null, TokenReadError>
  readonly listTokens: (options?: TokenSearchOptions) => Effect.Effect<TokenInfo[], TokenListError>
  readonly searchTokens: (query: string) => Effect.Effect<TokenInfo[], TokenListError>
  readonly getVerifiedTokens: () => Effect.Effect<TokenInfo[], TokenListError>
  readonly upsertToken: (token: Omit<TokenInfo, "createdAt" | "updatedAt">) => Effect.Effect<void>
}

// --- Tag ---

export const TokenService = Context.Service<TokenService>("@aetherdex/TokenService")

// --- D1-backed implementation ---

const makeTokenService = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient

  const getToken = (address: string): Effect.Effect<TokenInfo | null, TokenReadError, never> =>
    Effect.gen(function* () {
      const rows = (yield* sql`SELECT * FROM tokens WHERE address = ${address}`) as unknown as readonly Record<
        string,
        unknown
      >[]
      if (rows.length === 0) return null
      return rowToToken(rows[0] as Record<string, unknown>)
    }).pipe(Effect.catch((error) => Effect.fail(new TokenReadError(String(error)))))

  const listTokens = (options?: TokenSearchOptions): Effect.Effect<TokenInfo[], TokenListError, never> =>
    Effect.gen(function* () {
      const limit = Math.min(options?.limit ?? 100, 500)
      const verified = options?.verified
      const search = options?.query

      let rows: readonly Record<string, unknown>[] = []

      if (verified === true && search && search.length >= 2) {
        const searchPattern = `%${search.toLowerCase()}%`
        rows = (yield* sql`
          SELECT * FROM tokens
          WHERE is_verified = 1 AND (LOWER(symbol) LIKE ${searchPattern} OR LOWER(name) LIKE ${searchPattern})
          ORDER BY symbol ASC
          LIMIT ${limit}
        `) as unknown as readonly Record<string, unknown>[]
      } else if (verified === true) {
        rows = (yield* sql`
          SELECT * FROM tokens
          WHERE is_verified = 1
          ORDER BY symbol ASC
          LIMIT ${limit}
        `) as unknown as readonly Record<string, unknown>[]
      } else if (search && search.length >= 2) {
        const searchPattern = `%${search.toLowerCase()}%`
        rows = (yield* sql`
          SELECT * FROM tokens
          WHERE LOWER(symbol) LIKE ${searchPattern} OR LOWER(name) LIKE ${searchPattern}
          ORDER BY is_verified DESC, symbol ASC
          LIMIT ${limit}
        `) as unknown as readonly Record<string, unknown>[]
      } else {
        rows = (yield* sql`
          SELECT * FROM tokens
          ORDER BY is_verified DESC, symbol ASC
          LIMIT ${limit}
        `) as unknown as readonly Record<string, unknown>[]
      }

      return rows.map((r: Record<string, unknown>) => rowToToken(r))
    }).pipe(Effect.catch((error) => Effect.fail(new TokenListError(String(error)))))

  const searchTokens = (query: string): Effect.Effect<TokenInfo[], TokenListError, never> =>
    Effect.gen(function* () {
      if (query.length < 2) return []
      const searchPattern = `%${query.toLowerCase()}%`
      const rows = (yield* sql`
        SELECT * FROM tokens
        WHERE LOWER(symbol) LIKE ${searchPattern} OR LOWER(name) LIKE ${searchPattern}
        ORDER BY is_verified DESC, symbol ASC
        LIMIT 50
      `) as unknown as readonly Record<string, unknown>[]
      return rows.map((r: Record<string, unknown>) => rowToToken(r))
    }).pipe(Effect.catch((error) => Effect.fail(new TokenListError(String(error)))))

  const getVerifiedTokens = (): Effect.Effect<TokenInfo[], TokenListError, never> =>
    Effect.gen(function* () {
      const rows = (yield* sql`
        SELECT * FROM tokens
        WHERE is_verified = 1
        ORDER BY symbol ASC
        LIMIT 100
      `) as unknown as readonly Record<string, unknown>[]
      return rows.map((r: Record<string, unknown>) => rowToToken(r))
    }).pipe(Effect.catch((error) => Effect.fail(new TokenListError(String(error)))))

  const upsertToken = (token: Omit<TokenInfo, "createdAt" | "updatedAt">): Effect.Effect<void, never, never> =>
    Effect.gen(function* () {
      yield* sql`
        INSERT INTO tokens (chain_id, address, symbol, name, decimals, logo_url, is_verified, is_native, total_supply, created_at, updated_at)
        VALUES (${token.chainId}, ${token.address}, ${token.symbol}, ${token.name}, ${token.decimals}, ${token.logoUrl}, ${token.isVerified ? 1 : 0}, ${token.isNative ? 1 : 0}, ${token.totalSupply}, ${Date.now()}, ${Date.now()})
        ON CONFLICT(chain_id, address) DO UPDATE SET
          symbol = excluded.symbol,
          name = excluded.name,
          decimals = excluded.decimals,
          logo_url = excluded.logo_url,
          is_verified = excluded.is_verified,
          total_supply = excluded.total_supply,
          updated_at = excluded.updated_at
      `
    }).pipe(Effect.catch(() => Effect.succeed(undefined)))

  return {
    getToken,
    listTokens,
    searchTokens,
    getVerifiedTokens,
    upsertToken,
  }
})

// --- Live layer (requires SqlClient.SqlClient from D1) ---

export const TokenServiceLive = Layer.effect(TokenService, makeTokenService)
