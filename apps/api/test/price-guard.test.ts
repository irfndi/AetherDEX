import { env } from "cloudflare:test"
import { afterEach, describe, expect, it, vi } from "vitest"
import { evaluatePriceGuard, priceGuard } from "../src/routes/price-guard"

describe("price guard", () => {
  it("accepts an opening price within the configured deviation", () => {
    const result = evaluatePriceGuard(2, 1, 2.04, 500, 123)

    expect(result.expectedPrice).toBe(2)
    expect(result.deviationBps).toBe(200)
    expect(result.valid).toBe(true)
    expect(result.checkedAt).toBe(123)
  })

  it("rejects an opening price outside the configured deviation", () => {
    const result = evaluatePriceGuard(2, 1, 2.4, 500, 123)

    expect(result.deviationBps).toBe(2_000)
    expect(result.valid).toBe(false)
  })
})

const TOKEN0 = "0xA000000000000000000000000000000000000001"
const TOKEN1 = "0xB000000000000000000000000000000000000002"

const guardPath = (params: Record<string, string>): string => {
  const search = new URLSearchParams(params).toString()
  return `/price-guard?${search}`
}

const guardEnv = (): Env => ({ ...env, CHAIN_ID: "1" }) as unknown as Env

/** CoinGecko stub: returns per-token USD prices keyed by contract_addresses. */
const stubCoinGecko = (prices: Record<string, number>) =>
  vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
    const url = new URL(String(input))
    if (!url.hostname.includes("coingecko")) {
      return Response.json({ pairs: [] })
    }
    const address = url.searchParams.get("contract_addresses")?.toLowerCase()
    const usd = address === undefined ? undefined : prices[address]
    if (address === undefined || usd === undefined) return Response.json({ pairs: [] })
    return Response.json({ [address]: { usd } })
  })

describe("price guard route", () => {
  afterEach(() => vi.unstubAllGlobals())

  it("rejects a malformed price format", async () => {
    const response = await priceGuard.request(
      guardPath({ token0: TOKEN0, token1: TOKEN1, price: "abc" }),
      undefined,
      guardEnv(),
    )
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: "price must be a positive decimal" })
  })

  it("rejects non-positive or non-finite prices", async () => {
    for (const price of ["0", "-1"]) {
      const response = await priceGuard.request(
        guardPath({ token0: TOKEN0, token1: TOKEN1, price }),
        undefined,
        guardEnv(),
      )
      expect(response.status).toBe(400)
    }
  })

  it("returns 200 for a guard within the configured deviation", async () => {
    vi.stubGlobal("fetch", stubCoinGecko({ [TOKEN0.toLowerCase()]: 2, [TOKEN1.toLowerCase()]: 1 }))
    const response = await priceGuard.request(
      guardPath({ token0: TOKEN0, token1: TOKEN1, price: "2.04", maxDeviationBps: "500" }),
      undefined,
      guardEnv(),
    )
    expect(response.status).toBe(200)
    const body = (await response.json()) as { valid: boolean; deviationBps: number }
    expect(body.valid).toBe(true)
    expect(body.deviationBps).toBe(200)
  })

  it("returns 422 when the deviation exceeds the configured threshold", async () => {
    vi.stubGlobal("fetch", stubCoinGecko({ [TOKEN0.toLowerCase()]: 2, [TOKEN1.toLowerCase()]: 1 }))
    const response = await priceGuard.request(
      guardPath({ token0: TOKEN0, token1: TOKEN1, price: "2.4", maxDeviationBps: "500" }),
      undefined,
      guardEnv(),
    )
    expect(response.status).toBe(422)
    const body = (await response.json()) as { valid: boolean; deviationBps: number }
    expect(body.valid).toBe(false)
    expect(body.deviationBps).toBe(2_000)
  })

  it("returns a generic 503 without leaking internal error text when the price service fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("CoinGecko fetch failed: connect ECONNREFUSED https://api.coingecko.com")
      }),
    )
    const response = await priceGuard.request(
      guardPath({ token0: TOKEN0, token1: TOKEN1, price: "1" }),
      undefined,
      guardEnv(),
    )
    expect(response.status).toBe(503)
    const body = (await response.json()) as { error: string }
    expect(body.error).toBe("Price guard unavailable")
    expect(JSON.stringify(body)).not.toContain("coingecko")
    expect(JSON.stringify(body)).not.toContain("ECONNREFUSED")
  })
})
