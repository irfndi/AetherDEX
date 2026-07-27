import { env, runInDurableObject } from "cloudflare:test"
import { describe, expect, it } from "vitest"

describe("SIWE nonce Durable Object", () => {
  it("consumes a nonce only once under concurrent requests", async () => {
    const nonce = "abcdef0123456789abcdef0123456789"
    const stub = env.SIWE_NONCE.getByName(`concurrent-${nonce}`)
    await stub.fetch("https://siwe-nonce/issue", {
      method: "POST",
      body: JSON.stringify({ nonce, expiresAt: Date.now() + 60_000 }),
    })

    const results = await Promise.all(
      Array.from({ length: 8 }, () =>
        stub.fetch("https://siwe-nonce/consume", { method: "POST" }).then(async (response) => {
          const body = (await response.json()) as { readonly consumed?: boolean }
          return body.consumed === true
        }),
      ),
    )

    expect(results.filter(Boolean)).toHaveLength(1)
  })

  it("rejects an expired nonce", async () => {
    const stub = env.SIWE_NONCE.getByName("expired")
    await stub.fetch("https://siwe-nonce/issue", {
      method: "POST",
      body: JSON.stringify({ nonce: "abcdef0123456789abcdef0123456789", expiresAt: Date.now() - 1 }),
    })

    const response = await stub.fetch("https://siwe-nonce/consume", { method: "POST" })
    await expect(response.json()).resolves.toEqual({ consumed: false })
  })

  it("removes an unconsumed nonce when its expiry alarm runs", async () => {
    const stub = env.SIWE_NONCE.getByName("alarm-expiry")
    await stub.fetch("https://siwe-nonce/issue", {
      method: "POST",
      body: JSON.stringify({ nonce: "abcdef0123456789abcdef0123456789", expiresAt: Date.now() - 1 }),
    })

    await runInDurableObject(stub, (instance) => instance.alarm())
    const response = await stub.fetch("https://siwe-nonce/consume", { method: "POST" })
    await expect(response.json()).resolves.toEqual({ consumed: false })
  })
})
