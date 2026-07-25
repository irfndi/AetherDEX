/**
 * AetherDEX SIWE (Sign-In with Ethereum) authentication
 *
 * Nonces are consumed by one Durable Object per nonce; sessions use KV with 24-hour TTL.
 * Composes with KVCacheService for session operations.
 */

import { randomBytes } from "node:crypto"
import { Effect } from "effect"
import { SiweMessage, type SiweMessage as SiweMessageObj } from "siwe"
import { verifyMessage } from "viem"
import { KVCacheService, type SessionEntry } from "../services/kv"

export interface NonceResponse {
  nonce: string
  issuedAt: string
  expiresAt: string
}

export interface VerifyRequest {
  message: string
  signature: string
}

export interface SiweVerificationConfig {
  domain: string
  uri: string
  chainId: number
}

export interface AuthSessionToken {
  token: string
  userAddress: string
  expiresAt: number
}

export type AuthSession = SessionEntry

export function issueNonce(nonceNamespace: DurableObjectNamespace): Effect.Effect<NonceResponse, Error> {
  return Effect.gen(function* () {
    const nonce = randomBytes(16).toString("hex")
    const issuedAt = Date.now()
    const expiresAt = issuedAt + 5 * 60 * 1000

    const response = yield* Effect.tryPromise({
      try: () =>
        nonceNamespace.get(nonceNamespace.idFromName(nonce)).fetch("https://siwe-nonce/issue", {
          method: "POST",
          body: JSON.stringify({ nonce, expiresAt }),
        }),
      catch: () => new Error("Nonce issuance failed"),
    })
    if (!response.ok) return yield* Effect.fail(new Error("Nonce issuance failed"))

    return {
      nonce,
      issuedAt: new Date(issuedAt).toISOString(),
      expiresAt: new Date(expiresAt).toISOString(),
    }
  })
}

export function verifyAndCreateSession(
  nonceNamespace: DurableObjectNamespace,
  kv: KVNamespace,
  request: VerifyRequest,
  config: SiweVerificationConfig,
): Effect.Effect<AuthSessionToken, Error, KVCacheService> {
  return Effect.gen(function* () {
    let siweParsed: SiweMessageObj
    try {
      siweParsed = new SiweMessage(request.message)
    } catch {
      return yield* Effect.fail(new Error("Invalid SIWE message format"))
    }

    if (siweParsed.domain !== config.domain || siweParsed.uri !== config.uri) {
      return yield* Effect.fail(new Error("SIWE domain or URI mismatch"))
    }
    if (siweParsed.chainId !== config.chainId) {
      return yield* Effect.fail(new Error("SIWE chain mismatch"))
    }
    const now = Date.now()
    const parsedIssuedAt = Date.parse(siweParsed.issuedAt ?? "")
    const expirationTime = siweParsed.expirationTime ? Date.parse(siweParsed.expirationTime) : Number.NaN
    const notBefore = siweParsed.notBefore ? Date.parse(siweParsed.notBefore) : Number.NaN
    if (
      !Number.isFinite(parsedIssuedAt) ||
      parsedIssuedAt < now - 5 * 60 * 1000 ||
      parsedIssuedAt > now + 5 * 60 * 1000
    ) {
      return yield* Effect.fail(new Error("SIWE issued-at time is invalid"))
    }
    if (Number.isFinite(expirationTime) && expirationTime <= now) {
      return yield* Effect.fail(new Error("SIWE message expired"))
    }
    if (Number.isFinite(notBefore) && notBefore > now) {
      return yield* Effect.fail(new Error("SIWE message is not yet valid"))
    }

    const valid = yield* Effect.tryPromise({
      try: () =>
        verifyMessage({
          address: siweParsed.address as `0x${string}`,
          message: request.message,
          signature: request.signature as `0x${string}`,
        }),
      catch: () => new Error("Signature verification failed"),
    })

    if (!valid) {
      return yield* Effect.fail(new Error("Invalid signature"))
    }

    const consumed = yield* Effect.tryPromise({
      try: async () => {
        const response = await nonceNamespace
          .get(nonceNamespace.idFromName(siweParsed.nonce))
          .fetch("https://siwe-nonce/consume", { method: "POST" })
        if (!response.ok) return false
        const result = (await response.json()) as { readonly consumed?: boolean }
        return result.consumed === true
      },
      catch: () => new Error("Nonce consumption failed"),
    })
    if (!consumed) return yield* Effect.fail(new Error("Invalid or expired nonce"))

    const token = randomBytes(32).toString("hex")
    const issuedAt = Date.now()
    const expiresAt = issuedAt + 24 * 60 * 60 * 1000

    const session: SessionEntry = {
      userAddress: siweParsed.address,
      issuedAt,
      expiresAt,
      ...(siweParsed.chainId ? { chainId: siweParsed.chainId } : {}),
    }

    const svc = yield* KVCacheService
    yield* svc.putSession(kv, token, session, 86_400)

    return { token, userAddress: siweParsed.address, expiresAt }
  })
}

export function getSession(kv: KVNamespace, token: string): Effect.Effect<SessionEntry | null, Error, KVCacheService> {
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
