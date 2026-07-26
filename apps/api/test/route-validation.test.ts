import { describe, expect, it } from "vitest"
import { pools } from "../src/routes/pools"
import { priceGuard } from "../src/routes/price-guard"
import { swap } from "../src/routes/swap"
import { tokens } from "../src/routes/tokens"
import { v3Quote } from "../src/routes/v3-quote"

describe("route validation", () => {
  it("rejects an incomplete price guard request", async () => {
    const response = await priceGuard.request("/price-guard")

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: "token0, token1, and price are required" })
  })

  it("rejects an unsorted price guard pair", async () => {
    const response = await priceGuard.request(
      "/price-guard?token0=0xB000000000000000000000000000000000000001&token1=0xA000000000000000000000000000000000000001&price=1",
    )

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: "Tokens must be distinct, valid, and sorted" })
  })

  it("rejects an invalid price guard tolerance", async () => {
    const response = await priceGuard.request(
      "/price-guard?token0=0xA000000000000000000000000000000000000001&token1=0xB000000000000000000000000000000000000001&price=1&maxDeviationBps=2001",
    )

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: "maxDeviationBps must be an integer from 1 to 2000" })
  })

  it("rejects incomplete v3 quote parameters", async () => {
    const response = await v3Quote.request("/v3/quote")

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: "tokenIn, tokenOut, amountIn, and fee are required" })
  })

  it("rejects an invalid v3 quote amount", async () => {
    const response = await v3Quote.request(
      "/v3/quote?tokenIn=0xA000000000000000000000000000000000000001&tokenOut=0xB000000000000000000000000000000000000001&amountIn=0&fee=3000",
    )

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: "Invalid v3 quote amount or fee" })
  })

  it("rejects an excessive v3 quote slippage", async () => {
    const response = await v3Quote.request(
      "/v3/quote?tokenIn=0xA000000000000000000000000000000000000001&tokenOut=0xB000000000000000000000000000000000000001&amountIn=1&fee=3000&slippage=5.1",
    )

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: "Slippage must be between 0% and 5%" })
  })

  it("rejects an invalid pool id before accessing storage", async () => {
    const response = await pools.request("/not-a-pool")

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: "Invalid poolId (must be 0x + 64 hex chars)" })
  })

  it("rejects an invalid token address before accessing the token list", async () => {
    const response = await tokens.request("/not-an-address")

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: "Invalid token address" })
  })

  it("rejects an incomplete swap quote request", async () => {
    const response = await swap.request("/quote")

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: "Missing required query params: tokenIn, tokenOut, amountIn" })
  })

  it("rejects an invalid swap recipient", async () => {
    const response = await swap.request("/build", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ quote: {}, recipient: "not-an-address" }),
    })

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: "Invalid recipient address" })
  })
})
