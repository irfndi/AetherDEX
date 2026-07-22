import { Effect } from "effect"
import { describe, expect, it, vi } from "vitest"
import { listPools } from "../../src/lib/api"
import { poolsQueryOptions } from "../../src/lib/pools-query"

const samplePool = {
  poolId: "0xabc",
  token0Address: "0xtoken0",
  token1Address: "0xtoken1",
  fee: 3000,
  tickSpacing: 60,
  hookAddress: null,
  sqrtPriceX96: "1",
  currentTick: 0,
  liquidity: "1000",
  tvlUsd: 100,
  volume24hUsd: 50,
  fees24hUsd: 1,
  isActive: true,
  createdAt: 1,
  updatedAt: 2,
}

const validPayload = { pools: [samplePool], count: 1 }

const respondJson = (body: unknown) =>
  vi.mocked(globalThis.fetch).mockResolvedValueOnce(
    new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } }),
  )

describe("shared typed pools resolver", () => {
  it("exposes the shared query key", () => {
    const opts = poolsQueryOptions(25)
    expect(opts.queryKey).toEqual(["pools", { limit: 25, offset: 0 }])
  })

  it("decodes a valid payload through the shared PoolListResponseSchema", async () => {
    respondJson(validPayload)
    const result = await Effect.runPromise(listPools(25))
    expect(result.count).toBe(1)
    expect(result.pools[0]?.poolId).toBe("0xabc")
    expect(result.pools[0]?.isActive).toBe(true)
  })

  it("runs through the TanStack queryFn", async () => {
    respondJson(validPayload)
    const opts = poolsQueryOptions(25)
    const queryFn = opts.queryFn as () => Promise<{ count: number; pools: unknown[] }>
    const result = await queryFn()
    expect(result.count).toBe(1)
    expect(result.pools).toHaveLength(1)
  })

  it("rejects payloads that violate the shared schema", async () => {
    respondJson({ pools: [{ not: "a pool" }], count: 1 })
    await expect(Effect.runPromise(listPools())).rejects.toBeTruthy()
  })
})
