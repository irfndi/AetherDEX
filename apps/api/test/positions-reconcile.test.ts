import { env, SELF } from "cloudflare:test"
import { describe, expect, it } from "vitest"

describe("POST /api/v1/positions/v4/:tokenId/reconcile", () => {
  it("requires a session before reading chain state", async () => {
    const response = await SELF.fetch("http://fake-host/api/v1/positions/v4/1/reconcile", { method: "POST" })

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ error: "Authentication required" })
  })

  it("passes an authenticated request to the deployment configuration guard", async () => {
    await env.CACHE.put(
      "session:reconcile-test",
      JSON.stringify({
        userAddress: "0x1111111111111111111111111111111111111111",
        issuedAt: Date.now(),
        expiresAt: Date.now() + 60_000,
      }),
    )

    const response = await SELF.fetch("http://fake-host/api/v1/positions/v4/1/reconcile", {
      method: "POST",
      headers: { Authorization: "Bearer reconcile-test" },
    })

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toEqual({ error: "V4 position reconciliation is not configured" })
  })
})
