import { env, SELF } from "cloudflare:test"
import { describe, expect, it } from "vitest"
import { isValidV4TokenId } from "../src/services/v4-position-reader.service"

describe("V4 position token validation", () => {
  it("accepts uint256 values and rejects overflow", () => {
    expect(isValidV4TokenId("0")).toBe(true)
    expect(isValidV4TokenId("115792089237316195423570985008687907853269984665640564039457584007913129639935")).toBe(
      true,
    )
    expect(isValidV4TokenId("115792089237316195423570985008687907853269984665640564039457584007913129639936")).toBe(
      false,
    )
  })
})

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

  it("rejects a uint256-overflow token id at the HTTP boundary", async () => {
    await env.CACHE.put(
      "session:reconcile-overflow-test",
      JSON.stringify({
        userAddress: "0x1111111111111111111111111111111111111111",
        issuedAt: Date.now(),
        expiresAt: Date.now() + 60_000,
      }),
    )

    const response = await SELF.fetch(
      "http://fake-host/api/v1/positions/v4/115792089237316195423570985008687907853269984665640564039457584007913129639936/reconcile",
      {
        method: "POST",
        headers: { Authorization: "Bearer reconcile-overflow-test" },
      },
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: "Invalid token id" })
  })
})
