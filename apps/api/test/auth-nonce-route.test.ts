import { SELF } from "cloudflare:test"
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
  })
})
