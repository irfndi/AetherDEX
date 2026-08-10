import { env, SELF } from "cloudflare:test"
import { describe, expect, it } from "vitest"

const USER = "0x1111111111111111111111111111111111111111"
const VALID_TX_HASH = `0x${"a".repeat(64)}`
const VALID_POOL_ID = `0x${"b".repeat(64)}`
const TOKEN_IN = `0x${"c".repeat(40)}`
const TOKEN_OUT = `0x${"d".repeat(40)}`

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

async function recordSwap(body: unknown, token = "swap-record-validation-test"): Promise<Response> {
  await withSession(token)
  return SELF.fetch("http://fake-host/api/v1/record", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  })
}

const validBody = {
  txHash: VALID_TX_HASH,
  poolId: VALID_POOL_ID,
  tokenIn: TOKEN_IN,
  tokenOut: TOKEN_OUT,
  amountIn: "1000000000000000000",
  amountOut: "990000000000000000",
  amountUsd: 100,
  blockNumber: 1,
  blockTimestamp: 1,
}

describe("POST /api/v1/swap/record shape validation", () => {
  it("requires a session", async () => {
    const response = await SELF.fetch("http://fake-host/api/v1/record", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(validBody),
    })
    expect(response.status).toBe(401)
  })

  it("rejects a malformed txHash", async () => {
    const response = await recordSwap({ ...validBody, txHash: "0x123" })
    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: "Invalid txHash (must be 0x + 64 hex chars)" })
  })

  it("rejects a non-integer blockNumber", async () => {
    const response = await recordSwap({ ...validBody, blockNumber: "abc" })
    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: "Invalid blockNumber (must be a positive integer)" })
  })

  it("rejects a non-positive blockTimestamp", async () => {
    const response = await recordSwap({ ...validBody, blockTimestamp: -5 })
    expect(response.status).toBe(400)
  })

  it("rejects a malformed poolId", async () => {
    const response = await recordSwap({ ...validBody, poolId: "0xzz" })
    expect(response.status).toBe(400)
  })

  it("rejects a malformed token address", async () => {
    const response = await recordSwap({ ...validBody, tokenIn: "0xnot-an-address" })
    expect(response.status).toBe(400)
  })

  it("rejects a non-numeric amountIn", async () => {
    const response = await recordSwap({ ...validBody, amountIn: "12.5" })
    expect(response.status).toBe(400)
  })

  it("rejects a negative amountUsd", async () => {
    const response = await recordSwap({ ...validBody, amountUsd: -1 })
    expect(response.status).toBe(400)
  })

  it("refuses to persist a well-formed but unverified record when RPC is not configured", async () => {
    // RPC_URL is empty in the test environment: recording must fail closed with 503
    // instead of persisting a tx whose receipt was never verified.
    const response = await recordSwap(validBody)
    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toEqual({
      error: "Swap verification is not configured (RPC_URL required)",
    })
  })
})
