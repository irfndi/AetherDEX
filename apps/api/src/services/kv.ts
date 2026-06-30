/**
 * AetherDEX KV cache service
 * Hot caching layer for prices, SIWE nonces, and session data
 * Uses KV's built-in TTL via expirationTtl
 */

import { Effect, Option } from "effect"

export interface PriceEntry {
  tokenAddress: string
  priceUsd: number
  updatedAt: number
}

export interface SiweNonceEntry {
  nonce: string
  issuedAt: number
  expiresAt: number
}

export interface SessionEntry {
  userAddress: string
  issuedAt: number
  expiresAt: number
  /** Optional chain ID the session is bound to */
  chainId?: number
}

const KEY_PREFIXES = {
  price: "price:",
  siweNonce: "siwe-nonce:",
  session: "session:",
} as const

/**
 * KV Cache Service — typed wrapper around KVNamespace
 */
export class KVCacheService extends Effect.Service<KVCacheService>()(
  "@aetherdex/KVCacheService",
  {
    effect: Effect.succeed({
      /* ============ PRICES ============ */

      /**
       * Cache a price entry with TTL (default 60s)
       */
      putPrice: (kv: KVNamespace, entry: PriceEntry, ttlSeconds = 60) =>
        Effect.tryPromise({
          try: () =>
            kv.put(`${KEY_PREFIXES.price}${entry.tokenAddress}`, JSON.stringify(entry), {
              expirationTtl: ttlSeconds,
            }),
          catch: (e) => new Error(`KV put price failed: ${String(e)}`),
        }).pipe(Effect.asVoid),

      /**
       * Get a cached price
       */
      getPrice: (kv: KVNamespace, tokenAddress: string) =>
        Effect.gen(function* () {
          const raw = yield* Effect.tryPromise({
            try: () => kv.get(`${KEY_PREFIXES.price}${tokenAddress}`),
            catch: (e) => new Error(`KV get price failed: ${String(e)}`),
          })
          if (!raw) return Option.none<PriceEntry>()
          return Option.some(JSON.parse(raw) as PriceEntry)
        }),

      /**
       * Get multiple cached prices at once
       */
      getPrices: (kv: KVNamespace, tokenAddresses: string[]) =>
        Effect.gen(function* () {
          const result: Record<string, PriceEntry> = {}
          for (const addr of tokenAddresses) {
            const raw = yield* Effect.tryPromise({
              try: () => kv.get(`${KEY_PREFIXES.price}${addr}`),
              catch: (e) => new Error(`KV get price failed: ${String(e)}`),
            })
            if (raw) {
              result[addr] = JSON.parse(raw) as PriceEntry
            }
          }
          return result
        }),

      /* ============ SIWE NONCES ============ */

      /**
       * Store a SIWE nonce (5-minute TTL by default)
       */
      putSiweNonce: (kv: KVNamespace, entry: SiweNonceEntry, ttlSeconds = 300) =>
        Effect.tryPromise({
          try: () =>
            kv.put(`${KEY_PREFIXES.siweNonce}${entry.nonce}`, JSON.stringify(entry), {
              expirationTtl: ttlSeconds,
            }),
          catch: (e) => new Error(`KV put nonce failed: ${String(e)}`),
        }).pipe(Effect.asVoid),

      /**
       * Get a SIWE nonce (returns None if not found or expired)
       */
      getSiweNonce: (kv: KVNamespace, nonce: string) =>
        Effect.gen(function* () {
          const raw = yield* Effect.tryPromise({
            try: () => kv.get(`${KEY_PREFIXES.siweNonce}${nonce}`),
            catch: (e) => new Error(`KV get nonce failed: ${String(e)}`),
          })
          if (!raw) return Option.none<SiweNonceEntry>()
          return Option.some(JSON.parse(raw) as SiweNonceEntry)
        }),

      /**
       * Delete a SIWE nonce (consume it — single-use)
       */
      deleteSiweNonce: (kv: KVNamespace, nonce: string) =>
        Effect.tryPromise({
          try: () => kv.delete(`${KEY_PREFIXES.siweNonce}${nonce}`),
          catch: (e) => new Error(`KV delete nonce failed: ${String(e)}`),
        }).pipe(Effect.asVoid),

      /* ============ SESSIONS ============ */

      /**
       * Store a user session (24-hour TTL by default)
       */
      putSession: (kv: KVNamespace, token: string, entry: SessionEntry, ttlSeconds = 86_400) =>
        Effect.tryPromise({
          try: () =>
            kv.put(`${KEY_PREFIXES.session}${token}`, JSON.stringify(entry), {
              expirationTtl: ttlSeconds,
            }),
          catch: (e) => new Error(`KV put session failed: ${String(e)}`),
        }).pipe(Effect.asVoid),

      /**
       * Get a session by token
       */
      getSession: (kv: KVNamespace, token: string) =>
        Effect.gen(function* () {
          const raw = yield* Effect.tryPromise({
            try: () => kv.get(`${KEY_PREFIXES.session}${token}`),
            catch: (e) => new Error(`KV get session failed: ${String(e)}`),
          })
          if (!raw) return Option.none<SessionEntry>()
          return Option.some(JSON.parse(raw) as SessionEntry)
        }),

      /**
       * Delete a session (logout)
       */
      deleteSession: (kv: KVNamespace, token: string) =>
        Effect.tryPromise({
          try: () => kv.delete(`${KEY_PREFIXES.session}${token}`),
          catch: (e) => new Error(`KV delete session failed: ${String(e)}`),
        }).pipe(Effect.asVoid),
    }),
  },
) {}
