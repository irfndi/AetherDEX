import { env } from "cloudflare:test"
import { encodeAbiParameters } from "viem"
import { afterEach, describe, expect, it, vi } from "vitest"
import { v3Quote } from "../src/routes/v3-quote"

const TOKEN_IN = "0x6B175474E89094C44Da98b954EedeAC495271d0F" // DAI
const TOKEN_OUT = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2" // WETH
const FACTORY = "0x1F98431c8aD98523631AE4a59f267346ea31F984" // Uniswap V3 factory
const QUOTER = "0x61fFE014bA17989E743c5F6cB21bF9697530B21e" // Uniswap V3 quoter
const POOL = "0x8ad599c3A0ff1De082011EFDDc58f1908eb6e6D8" // USDC/ETH 0.3% pool
const RPC_URL = "https://rpc.aetherdex.test"

const quotePath = (params: Record<string, string>): string => {
  const search = new URLSearchParams(params).toString()
  return `/v3/quote?${search}`
}

const baseParams = (overrides: Record<string, string> = {}): Record<string, string> => ({
  tokenIn: TOKEN_IN,
  tokenOut: TOKEN_OUT,
  amountIn: "1000000",
  fee: "3000",
  ...overrides,
})

const testEnv = (overrides: Record<string, unknown> = {}): Env =>
  ({
    ...env,
    RPC_URL,
    V3_FACTORY_ADDRESS: FACTORY,
    V3_QUOTER_ADDRESS: QUOTER,
    CHAIN_ID: "1",
    ...overrides,
  }) as unknown as Env

/** Minimal JSON-RPC mock: factory eth_call returns a real pool, quoter returns a quote tuple. */
const mockRpc = (amountOut = 1_000_000n) =>
  vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? "")) as {
      id: number
      method: string
      params?: Array<{ to?: string }>
    }
    const to = body.params?.[0]?.to?.toLowerCase()
    if (body.method === "eth_call" && to === FACTORY.toLowerCase()) {
      return Response.json({ jsonrpc: "2.0", id: body.id, result: encodeAbiParameters([{ type: "address" }], [POOL]) })
    }
    if (body.method === "eth_call" && to === QUOTER.toLowerCase()) {
      const result = encodeAbiParameters(
        [{ type: "uint256" }, { type: "uint160" }, { type: "uint32" }, { type: "uint256" }],
        [amountOut, 2n ** 80n, 5n, 150_000n] as unknown as [bigint, bigint, number, bigint],
      )
      return Response.json({ jsonrpc: "2.0", id: body.id, result })
    }
    return Response.json({ jsonrpc: "2.0", id: body.id, result: "0x1" })
  })

describe("GET /v3/quote — validation", () => {
  it("rejects missing parameters", async () => {
    const response = await v3Quote.request("/v3/quote", undefined, testEnv())
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: "tokenIn, tokenOut, amountIn, and fee are required" })
  })

  it("rejects malformed addresses, amounts, and fees", async () => {
    const invalidCases: Record<string, string>[] = [
      { tokenIn: "0x123" },
      { tokenOut: "not-an-address" },
      { amountIn: "abc" },
      { fee: "3k" },
    ]
    for (const overrides of invalidCases) {
      const response = await v3Quote.request(quotePath(baseParams(overrides)), undefined, testEnv())
      expect(response.status).toBe(400)
    }
  })

  it("rejects a non-positive amount", async () => {
    const response = await v3Quote.request(quotePath(baseParams({ amountIn: "0" })), undefined, testEnv())
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: "Invalid v3 quote amount or fee" })
  })

  it("rejects fee values outside the canonical V3 fee tiers", async () => {
    for (const fee of ["1", "200", "2500", "10001"]) {
      const response = await v3Quote.request(quotePath(baseParams({ fee })), undefined, testEnv())
      expect(response.status).toBe(400)
    }
  })

  it("rejects an amountIn longer than uint256 (CPU-amplification guard)", async () => {
    const response = await v3Quote.request(quotePath(baseParams({ amountIn: "9".repeat(79) })), undefined, testEnv())
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: "amountIn must not exceed uint256 (max 78 digits)" })
  })

  it("rejects slippage outside 0%–5%", async () => {
    for (const slippage of ["5.1", "-0.1", "abc"]) {
      const response = await v3Quote.request(quotePath(baseParams({ slippage })), undefined, testEnv())
      expect(response.status).toBe(400)
    }
  })
})

describe("GET /v3/quote — env configuration", () => {
  it("returns 503 when the v3 service is not configured", async () => {
    const response = await v3Quote.request(
      quotePath(baseParams()),
      undefined,
      testEnv({ RPC_URL: "", V3_FACTORY_ADDRESS: "", V3_QUOTER_ADDRESS: "" }),
    )
    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({ error: "V3 quote service is not configured" })
  })
})

describe("GET /v3/quote — RPC-backed behavior", () => {
  afterEach(() => vi.unstubAllGlobals())

  it("returns 404 for no_pool and a client-safe message", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "")) as {
        id: number
        method: string
        params?: Array<{ to?: string }>
      }
      if (body.method !== "eth_call") {
        return Response.json({ jsonrpc: "2.0", id: body.id, result: "0x1" })
      }
      return Response.json({
        jsonrpc: "2.0",
        id: body.id,
        result: encodeAbiParameters([{ type: "address" }], ["0x0000000000000000000000000000000000000000"]),
      })
    })
    vi.stubGlobal("fetch", fetchMock)
    const response = await v3Quote.request(quotePath(baseParams()), undefined, testEnv())
    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ error: "No v3 pool exists for this fee tier", reason: "no_pool" })
  })

  it("returns a generic 503 without leaking the RPC error for rpc_error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error(`connect ECONNREFUSED ${RPC_URL}`)
      }),
    )
    const response = await v3Quote.request(quotePath(baseParams()), undefined, testEnv())
    expect(response.status).toBe(503)
    const body = (await response.json()) as { error: string; reason: string }
    expect(body.reason).toBe("rpc_error")
    expect(body.error).toBe("Quote failed")
    expect(JSON.stringify(body)).not.toContain(RPC_URL)
    expect(JSON.stringify(body)).not.toContain("ECONNREFUSED")
  })

  it("returns a quote with exact minAmountOut slippage math", async () => {
    vi.stubGlobal("fetch", mockRpc(1_000_000n))
    const response = await v3Quote.request(quotePath(baseParams({ slippage: "0.5" })), undefined, testEnv())
    expect(response.status).toBe(200)
    const body = (await response.json()) as {
      amountOut: string
      minAmountOut: string
      initializedTicksCrossed: number
      gasEstimate: string
      protocolFee: { chargedHere: boolean }
    }
    expect(body.amountOut).toBe("1000000")
    // (1_000_000 * (10_000 - 50)) / 10_000 with slippage 0.5%
    expect(body.minAmountOut).toBe("995000")
    expect(body.initializedTicksCrossed).toBe(5)
    expect(body.gasEstimate).toBe("150000")
    expect(body.protocolFee.chargedHere).toBe(false)
  })

  it("serves identical repeated requests from the in-memory cache without re-hitting the RPC", async () => {
    const fetchMock = mockRpc(1_000_000n)
    vi.stubGlobal("fetch", fetchMock)
    const path = quotePath(baseParams({ amountIn: "777", slippage: "1" }))
    const first = await v3Quote.request(path, undefined, testEnv())
    const callsAfterFirst = fetchMock.mock.calls.length
    expect(first.status).toBe(200)
    // First request: chainId probe + factory getPool + quoter simulation. Second must be served from cache.
    expect(callsAfterFirst).toBeGreaterThan(0)
    const second = await v3Quote.request(path, undefined, testEnv())
    expect(second.status).toBe(200)
    expect(fetchMock.mock.calls.length).toBe(callsAfterFirst)
  })
})
