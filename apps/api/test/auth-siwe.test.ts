import { env } from "cloudflare:test"
import { Effect } from "effect"
import { SiweMessage } from "siwe"
import { describe, expect, it } from "vitest"
import { verifyAndCreateSession } from "../src/auth/siwe"
import { KVCacheService } from "../src/services/kv"

const config = {
  domain: "aetherdex.io",
  uri: "https://aetherdex.io",
  chainId: 11155111,
}

const makeMessage = (overrides: Partial<{ domain: string; uri: string; chainId: number }>) =>
  new SiweMessage({
    domain: overrides.domain ?? config.domain,
    address: "0x1111111111111111111111111111111111111111",
    statement: "Sign in to AetherDEX.",
    uri: overrides.uri ?? config.uri,
    version: "1",
    chainId: overrides.chainId ?? config.chainId,
    nonce: "1234567890",
    issuedAt: new Date().toISOString(),
  }).prepareMessage()

describe("SIWE verification binding", () => {
  it("rejects a message from another domain before signature verification", async () => {
    await env.CACHE.put(
      "siwe-nonce:1234567890",
      JSON.stringify({ nonce: "1234567890", issuedAt: Date.now(), expiresAt: Date.now() + 60_000 }),
    )

    const error = await Effect.runPromise(
      verifyAndCreateSession(
        env.CACHE,
        { message: makeMessage({ domain: "attacker.example" }), signature: "0x" },
        config,
      ).pipe(Effect.provide(KVCacheService.layer), Effect.flip),
    )

    expect(String((error as Error).message)).toBe("SIWE domain or URI mismatch")
  })

  it("rejects a message for another chain before signature verification", async () => {
    await env.CACHE.put(
      "siwe-nonce:1234567890",
      JSON.stringify({ nonce: "1234567890", issuedAt: Date.now(), expiresAt: Date.now() + 60_000 }),
    )

    const error = await Effect.runPromise(
      verifyAndCreateSession(env.CACHE, { message: makeMessage({ chainId: 1 }), signature: "0x" }, config).pipe(
        Effect.provide(KVCacheService.layer),
        Effect.flip,
      ),
    )

    expect(String((error as Error).message)).toBe("SIWE chain mismatch")
  })
})
