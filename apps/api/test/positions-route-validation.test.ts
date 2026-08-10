import { env, SELF } from "cloudflare:test"
import { describe, expect, it } from "vitest"

const USER = "0x1111111111111111111111111111111111111111"
const VALID_POOL_ID = `0x${"a".repeat(64)}`

async function withSession(token: string): Promise<void> {
  await env.CACHE.put(
    `session:${token}`,
    JSON.stringify({
      userAddress: USER,
      issuedAt: Date.now(),
      expiresAt: Date.now() + 60_000,
      chainId: 11155111,
    }),
  )
}

async function postPosition(body: unknown, token = "pos-validation-test"): Promise<Response> {
  await withSession(token)
  return SELF.fetch("http://fake-host/api/v1/positions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  })
}

describe("POST /api/v1/positions format validation", () => {
  it("requires a session", async () => {
    const response = await SELF.fetch("http://fake-host/api/v1/positions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    })
    expect(response.status).toBe(401)
  })

  it("rejects a malformed poolId", async () => {
    const response = await postPosition({
      poolId: "garbage",
      tickLower: -100,
      tickUpper: 100,
      liquidity: "1000",
    })
    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: "Invalid position values (poolId, ticks, or liquidity)" })
  })

  it("rejects fractional ticks", async () => {
    const response = await postPosition({
      poolId: VALID_POOL_ID,
      tickLower: 1.5,
      tickUpper: 100,
      liquidity: "1000",
    })
    expect(response.status).toBe(400)
  })

  it("rejects out-of-range ticks", async () => {
    const response = await postPosition({
      poolId: VALID_POOL_ID,
      tickLower: -900_000,
      tickUpper: 100,
      liquidity: "1000",
    })
    expect(response.status).toBe(400)
  })

  it("rejects an inverted tick range", async () => {
    const response = await postPosition({
      poolId: VALID_POOL_ID,
      tickLower: 200,
      tickUpper: 100,
      liquidity: "1000",
    })
    expect(response.status).toBe(400)
  })

  it("rejects a non-numeric liquidity", async () => {
    const response = await postPosition({
      poolId: VALID_POOL_ID,
      tickLower: -100,
      tickUpper: 100,
      liquidity: "not-a-number",
    })
    expect(response.status).toBe(400)
  })

  it("rejects an unknown protocol", async () => {
    const response = await postPosition({
      poolId: VALID_POOL_ID,
      tickLower: -100,
      tickUpper: 100,
      liquidity: "1000",
      protocol: "v5",
    })
    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: "protocol must be 'v3' or 'v4'" })
  })

  it("rejects a malformed tokenId", async () => {
    const response = await postPosition({
      poolId: VALID_POOL_ID,
      tickLower: -100,
      tickUpper: 100,
      liquidity: "1000",
      tokenId: "12abc",
    })
    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: "Invalid tokenId (must be a non-negative integer string)" })
  })

  it("accepts a well-formed position past validation", async () => {
    const response = await postPosition({
      poolId: VALID_POOL_ID,
      tickLower: -100,
      tickUpper: 100,
      liquidity: "1000",
      protocol: "v4",
      tokenId: "42",
    })
    // Validation passed; storage may still fail in the test D1 — but never a 400.
    expect(response.status).not.toBe(400)
  })
})
