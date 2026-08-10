import { env } from "cloudflare:test"
import { Effect } from "effect"
import { SiweMessage } from "siwe"
import { privateKeyToAccount } from "viem/accounts"
import { afterEach, describe, expect, it } from "vitest"
import { auth } from "../src/auth/routes"
import { issueNonce } from "../src/auth/siwe"

// Well-known dev accounts (hardhat #0 / #1) — never used in production.
const WALLET = privateKeyToAccount("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d")
const OTHER_WALLET = privateKeyToAccount("0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80")

const CHAIN_ID = 11155111
const DOMAIN = "localhost"
const URI = "http://localhost:3000"

const testEnv = {
  ...env,
  SIWE_DOMAIN: DOMAIN,
  SIWE_URI: URI,
  CHAIN_ID: String(CHAIN_ID),
}

const FIXED_SESSION_KEYS = ["session:test-expired", "session:test-malformed"] as const

async function issueSignedMessage(): Promise<{ message: string; signature: string }> {
  const nonceResponse = await Effect.runPromise(issueNonce(env.SIWE_NONCE))
  const message = new SiweMessage({
    domain: DOMAIN,
    address: WALLET.address,
    uri: URI,
    version: "1",
    chainId: CHAIN_ID,
    nonce: nonceResponse.nonce,
    issuedAt: new Date().toISOString(),
  })
  const prepared = message.prepareMessage()
  const signature = await WALLET.signMessage({ message: prepared })
  return { message: prepared, signature }
}

const postVerify = (body: string, bindings: typeof testEnv = testEnv) =>
  auth.request("/verify", { method: "POST", headers: { "content-type": "application/json" }, body }, bindings)

describe("SIWE auth flow", () => {
  afterEach(async () => {
    await Promise.all(FIXED_SESSION_KEYS.map((key) => env.CACHE.delete(key)))
  })

  it("verifies a signed message and reads the session back via /me", async () => {
    const { message, signature } = await issueSignedMessage()
    const verifyResponse = await postVerify(JSON.stringify({ message, signature }))
    expect(verifyResponse.status).toBe(200)
    const body = (await verifyResponse.json()) as { token: string; userAddress: string }
    expect(body.userAddress.toLowerCase()).toBe(WALLET.address.toLowerCase())

    const meResponse = await auth.request("/me", { headers: { Authorization: `Bearer ${body.token}` } }, testEnv)
    expect(meResponse.status).toBe(200)
    const me = (await meResponse.json()) as { session: { userAddress: string } }
    expect(me.session.userAddress.toLowerCase()).toBe(WALLET.address.toLowerCase())
  })

  it("rejects a replayed nonce with 401 (nonces are single-use)", async () => {
    const { message, signature } = await issueSignedMessage()
    const first = await postVerify(JSON.stringify({ message, signature }))
    expect(first.status).toBe(200)

    const replay = await postVerify(JSON.stringify({ message, signature }))
    expect(replay.status).toBe(401)
  })

  it("returns 401 for a signature from a different wallet", async () => {
    const { message } = await issueSignedMessage()
    const signature = await OTHER_WALLET.signMessage({ message })
    const response = await postVerify(JSON.stringify({ message, signature }))
    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ error: "Authentication failed" })
  })

  it("returns 500 (not 401) when the nonce Durable Object fails", async () => {
    const { message, signature } = await issueSignedMessage()
    const brokenNamespace = {
      idFromName: () => {
        throw new Error("DO down")
      },
      get: () => {
        throw new Error("DO down")
      },
    } as unknown as DurableObjectNamespace
    const response = await postVerify(JSON.stringify({ message, signature }), {
      ...testEnv,
      SIWE_NONCE: brokenNamespace,
    })
    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({ error: "Internal server error" })
  })

  it("returns 400 for a malformed JSON body", async () => {
    const response = await postVerify("{not json")
    expect(response.status).toBe(400)
  })

  it("rejects an expired session with 401 and removes the KV key", async () => {
    await env.CACHE.put(
      "session:test-expired",
      JSON.stringify({
        userAddress: WALLET.address,
        issuedAt: Date.now() - 60_000,
        expiresAt: Date.now() - 1,
        chainId: CHAIN_ID,
      }),
    )
    const response = await auth.request("/me", { headers: { Authorization: "Bearer test-expired" } }, testEnv)
    expect(response.status).toBe(401)
    await expect(env.CACHE.get("session:test-expired")).resolves.toBeNull()
  })

  it("deletes a malformed session payload and falls through to 401", async () => {
    await env.CACHE.put("session:test-malformed", "{not json")
    const response = await auth.request("/me", { headers: { Authorization: "Bearer test-malformed" } }, testEnv)
    expect(response.status).toBe(401)
    await expect(env.CACHE.get("session:test-malformed")).resolves.toBeNull()
  })

  it("logs out by deleting the session so /me returns 401", async () => {
    const { message, signature } = await issueSignedMessage()
    const verifyResponse = await postVerify(JSON.stringify({ message, signature }))
    const body = (await verifyResponse.json()) as { token: string }
    const bearer = { headers: { Authorization: `Bearer ${body.token}` } }

    const logoutResponse = await auth.request("/logout", { method: "POST", ...bearer }, testEnv)
    expect(logoutResponse.status).toBe(200)

    const meResponse = await auth.request("/me", bearer, testEnv)
    expect(meResponse.status).toBe(401)
  })
})
