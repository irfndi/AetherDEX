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

const queryContext = () => ({ signal: new AbortController().signal })

const runQueryFn = async (opts: ReturnType<typeof poolsQueryOptions>, context: { signal: AbortSignal }) => {
  const queryFn = opts.queryFn as (ctx: { signal: AbortSignal }) => Promise<{ count: number; pools: unknown[] }>
  return queryFn(context)
}

describe("shared typed pools resolver", () => {
  it("exposes the shared query key including filters", () => {
    const opts = poolsQueryOptions(25, 0, { sortBy: "volume", filterToken: "0xtok" })
    expect(opts.queryKey).toEqual([
      "pools",
      { limit: 25, offset: 0, sortBy: "volume", sortDirection: "desc", filterToken: "0xtok" },
    ])
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
    const result = await runQueryFn(opts, queryContext())
    expect(result.count).toBe(1)
    expect(result.pools).toHaveLength(1)
  })

  it("forwards the TanStack abort signal to the underlying fetch", async () => {
    respondJson(validPayload)
    const opts = poolsQueryOptions(25)
    const context = queryContext()
    await runQueryFn(opts, context)
    const lastFetchCall = vi.mocked(globalThis.fetch).mock.calls.at(-1)
    expect(lastFetchCall?.[1]?.signal).toBe(context.signal)
  })

  it("rejects when the query is aborted", async () => {
    vi.mocked(globalThis.fetch).mockImplementationOnce(async (_input, init) => {
      if (init?.signal?.aborted) {
        throw new DOMException("The operation was aborted.", "AbortError")
      }
      return new Response(JSON.stringify(validPayload), { status: 200 })
    })
    const controller = new AbortController()
    controller.abort()
    await expect(runQueryFn(poolsQueryOptions(25), { signal: controller.signal })).rejects.toThrow()
  })

  it("sends sortBy and filterToken query params when provided", async () => {
    respondJson(validPayload)
    await Effect.runPromise(listPools(10, 5, { sortBy: "fees", filterToken: "0xtok" }))
    const lastFetchCall = vi.mocked(globalThis.fetch).mock.calls.at(-1)
    const url = String(lastFetchCall?.[0])
    expect(url).toContain("sortBy=fees")
    expect(url).toContain("filterToken=0xtok")
  })

  it("rejects payloads that violate the shared schema", async () => {
    respondJson({ pools: [{ not: "a pool" }], count: 1 })
    await expect(Effect.runPromise(listPools())).rejects.toBeTruthy()
  })
})
