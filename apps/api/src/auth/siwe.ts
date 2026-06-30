/**
 * AetherDEX SIWE (Sign-In with Ethereum) authentication
 *
 * Nonces stored in KV with 5-min TTL, sessions with 24-hour TTL.
 * Composes with KVCacheService for all KV operations.
 */

import { Effect } from "effect"
import { SiweMessage, type SiweMessage as SiweMessageObj } from "siwe"
import { verifyMessage } from "viem"
import { KVCacheService, type SessionEntry } from "../services/kv"
import { randomBytes } from "node:crypto"

export interface NonceResponse {
  nonce: string
  issuedAt: string
  expiresAt: string
}

export interface VerifyRequest {
  message: string
  signature: string
}

export interface AuthSessionToken {
  token: string
  userAddress: string
  expiresAt: number
}

export type AuthSession = SessionEntry

export function issueNonce(kv: KVNamespace): Effect.Effect<NonceResponse, Error, KVCacheService> {
  return Effect.gen(function* () {
    const nonce = randomBytes(16).toString("hex")
    const issuedAt = Date.now()
    const expiresAt = issuedAt + 5 * 60 * 1000

    const svc = yield* KVCacheService
    yield* svc.putSiweNonce(kv, { nonce, issuedAt, expiresAt }, 300)

    return {
      nonce,
      issuedAt: new Date(issuedAt).toISOString(),
      expiresAt: new Date(expiresAt).toISOString(),
    }
  })
}

export function verifyAndCreateSession(
  kv: KVNamespace,
  request: VerifyRequest,
): Effect.Effect<AuthSessionToken, Error, KVCacheService> {
  return Effect.gen(function* () {
    let siweParsed: SiweMessageObj
    try {
      siweParsed = new SiweMessage(request.message)
    } catch {
      return yield* Effect.fail(new Error("Invalid SIWE message format"))
    }

    const svc = yield* KVCacheService
    const nonceEntry = yield* svc.getSiweNonce(kv, siweParsed.nonce)
    if (nonceEntry._tag === "None") {
      return yield* Effect.fail(new Error("Invalid or expired nonce"))
    }

    const valid = yield* Effect.tryPromise({
      try: () =>
        verifyMessage({
          address: siweParsed.address as `0x${string}`,
          message: request.message,
          signature: request.signature as `0x${string}`,
        }),
      catch: (e) => new Error(`Signature verification failed: ${String(e)}`),
    })

    if (!valid) {
      return yield* Effect.fail(new Error("Invalid signature"))
    }

    yield* svc.deleteSiweNonce(kv, siweParsed.nonce)

    const token = randomBytes(32).toString("hex")
    const issuedAt = Date.now()
    const expiresAt = issuedAt + 24 * 60 * 60 * 1000

    const session: SessionEntry = {
      userAddress: siweParsed.address,
      issuedAt,
      expiresAt,
      ...(siweParsed.chainId ? { chainId: siweParsed.chainId } : {}),
    }

    yield* svc.putSession(kv, token, session, 86_400)

    return { token, userAddress: siweParsed.address, expiresAt }
  })
}

export function getSession(
  kv: KVNamespace,
  token: string,
): Effect.Effect<SessionEntry | null, Error, KVCacheService> {
  return Effect.gen(function* () {
    const svc = yield* KVCacheService
    const result = yield* svc.getSession(kv, token)
    if (result._tag === "None") return null
    return result.value
  })
}

export function deleteSession(kv: KVNamespace, token: string): Effect.Effect<void, Error, KVCacheService> {
  return Effect.gen(function* () {
    const svc = yield* KVCacheService
    yield* svc.deleteSession(kv, token)
  })
}
