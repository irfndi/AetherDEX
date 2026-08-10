import { describe, expect, it } from "vitest"
import { pools } from "../src/routes/pools"
import { swap } from "../src/routes/swap"
import { tokens } from "../src/routes/tokens"
import { tpSl } from "../src/routes/tp-sl"

const TOKEN_IN = "0xA000000000000000000000000000000000000001"
const TOKEN_OUT = "0xB000000000000000000000000000000000000002"
const VALID_POOL_ID = `0x${"a".repeat(64)}`
const VALID_ADDRESS = `0x${"A".repeat(40)}`

describe("GET /api/v1/quote slippage validation", () => {
  const quoteUrl = (slippage: string) =>
    `/quote?tokenIn=${TOKEN_IN}&tokenOut=${TOKEN_OUT}&amountIn=1000000000000000000&slippage=${slippage}`

  it("rejects non-numeric slippage", async () => {
    const response = await swap.request(quoteUrl("abc"))
    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: "Slippage must be between 0% and 100%" })
  })

  it("rejects negative slippage", async () => {
    const response = await swap.request(quoteUrl("-1"))
    expect(response.status).toBe(400)
  })

  it("rejects unbounded slippage", async () => {
    const response = await swap.request(quoteUrl("999"))
    expect(response.status).toBe(400)
  })

  it("accepts in-range slippage and proceeds past validation", async () => {
    const response = await swap.request(quoteUrl("0.5"))
    // Not a 400: validation passed; without env bindings the handler fails later.
    expect(response.status).not.toBe(400)
  })
})

describe("GET /api/v1/pools query validation", () => {
  // chainId is checked first, so every request carries a valid CHAIN_ID env.
  const env = { CHAIN_ID: "1" } as never

  it("rejects an unknown sortBy", async () => {
    const response = await pools.request("/?sortBy=name", {}, env)
    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      error: "sortBy must be one of: tvl, volume, fees, created; sortDirection must be asc or desc",
    })
  })

  it("rejects an unknown sortDirection", async () => {
    const response = await pools.request("/?sortDirection=sideways", {}, env)
    expect(response.status).toBe(400)
  })

  it("rejects a malformed filterToken", async () => {
    const response = await pools.request("/?filterToken=not-an-address", {}, env)
    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: "Invalid filterToken (must be 0x + 40 hex chars)" })
  })

  it("accepts a valid filterToken past validation", async () => {
    const response = await pools.request(`/?filterToken=${VALID_ADDRESS.toLowerCase()}`, {}, env)
    expect(response.status).not.toBe(400)
  })

  it("accepts valid sort params past validation", async () => {
    const response = await pools.request("/?sortBy=tvl&sortDirection=asc&limit=10", {}, env)
    expect(response.status).not.toBe(400)
  })
})

describe("GET /api/v1/tokens verified filter", () => {
  it("rejects a non-boolean verified value", async () => {
    const response = await tokens.request("/?verified=maybe")
    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: "verified must be 'true' or 'false'" })
  })

  it("accepts verified=true past validation", async () => {
    const response = await tokens.request("/?verified=true")
    expect(response.status).not.toBe(400)
  })

  it("returns a generic 500 without leaking internal error details", async () => {
    // No env bindings: the token-list layer cannot be constructed, so the handler
    // fails server-side. The body must be the stable generic shape, not String(err).
    const response = await tokens.request("/")
    expect(response.status).toBe(500)
    const body = (await response.json()) as { error?: string }
    expect(body.error).toBe("Internal server error")
    expect(JSON.stringify(body)).not.toMatch(/Cannot read|undefined|Error:/)
  })
})

describe("GET /api/v1/tp-sl/orders/:id id parsing", () => {
  it("rejects an id with trailing garbage instead of parsing it", async () => {
    const response = await tpSl.request("/orders/12abc")
    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: "Invalid order id" })
  })

  it("rejects an id beyond Number.MAX_SAFE_INTEGER instead of losing precision", async () => {
    const response = await tpSl.request("/orders/9007199254740993")
    expect(response.status).toBe(400)
  })

  it("accepts a digit id and fails on chain config, never a Sepolia fallback", async () => {
    const response = await tpSl.request("/orders/5", {}, { CHAIN_ID: "not-a-number" } as never)
    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({ error: "Invalid chain configuration" })
  })

  it("returns 500 Invalid chain configuration when CHAIN_ID is missing", async () => {
    const response = await tpSl.request("/orders/5", {}, {} as never)
    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({ error: "Invalid chain configuration" })
  })
})

describe("TP/SL pool routes keep chainId strict", () => {
  it("rejects a non-numeric CHAIN_ID on GET /pools/:poolId", async () => {
    const response = await tpSl.request(`/pools/${VALID_POOL_ID}`, {}, { CHAIN_ID: "" } as never)
    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({ error: "Invalid chain configuration" })
  })
})
