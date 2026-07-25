import { env, SELF } from "cloudflare:test"
import { describe, expect, it } from "vitest"

describe("POST /api/v1/auth/nonce", () => {
  it("issues a nonce through the Durable Object authority", async () => {
    const response = await SELF.fetch("http://fake-host/api/v1/auth/nonce", { method: "POST" })
    const body = (await response.json()) as {
      readonly nonce?: string
      readonly issuedAt?: string
      readonly expiresAt?: string
    }

    expect(response.status).toBe(200)
    expect(body.nonce).toMatch(/^[a-f0-9]{32}$/)
    expect(body.issuedAt).toEqual(expect.any(String))
    expect(body.expiresAt).toEqual(expect.any(String))

    const nonce = body.nonce
    if (nonce) {
      const consumeResponse = await env.SIWE_NONCE.get(env.SIWE_NONCE.idFromName(nonce)).fetch(
        "https://siwe-nonce/consume",
        {
          method: "POST",
        },
      )
      expect(consumeResponse.status).toBe(200)
      await expect(consumeResponse.json()).resolves.toEqual({ consumed: true })
    }
  })
})
