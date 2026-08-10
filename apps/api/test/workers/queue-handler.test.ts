/**
 * Worker queue handlers — price refresh and TP/SL trigger evaluation.
 *
 * Covers:
 * - fetchTokenPrice resolves the CoinGecko platform from the chain id and
 *   fails closed for unsupported chains (clawpatch 3282)
 * - price KV keys are chain-scoped (3282)
 * - a hanging upstream fetch aborts within the bounded timeout and the
 *   refresh continues to the next token (72c1)
 * - parameterized TP/SL dual-trigger branches (3ad6)
 */

import { env } from "cloudflare:test"
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import m0001 from "../../migrations/0001_initial_schema.sql?raw"
import m0002 from "../../migrations/0002_seed_data.sql?raw"
import m0003 from "../../migrations/0003_chain_scoped_tokens.sql?raw"
import m0004 from "../../migrations/0004_phase1_chain_and_events.sql?raw"
import m0005PoolKeys from "../../migrations/0005_chain_qualified_pool_keys.sql?raw"
import m0005TpSl from "../../migrations/0005_tp_sl_orders.sql?raw"
import m0006 from "../../migrations/0006_chain_qualified_price_cache.sql?raw"
import m0007 from "../../migrations/0007_v3_indexer_cursor.sql?raw"
import m0008 from "../../migrations/0008_tp_sl_onchain_order_id.sql?raw"
import {
  evaluateTpSlTrigger,
  fetchTokenPrice,
  type PriceRefreshMessage,
  processQueueBatch,
  type QueueEnv,
} from "../../src/workers/queue-handler"

const MIGRATIONS = [m0001, m0002, m0003, m0004, m0005PoolKeys, m0005TpSl, m0006, m0007, m0008]

const splitStatements = (script: string): string[] =>
  script
    .split("\n")
    .map((line) => line.split("--")[0])
    .join("\n")
    .split(";")
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0 && !statement.startsWith("PRAGMA foreign_key_check"))

beforeAll(async () => {
  for (const script of MIGRATIONS) {
    for (const statement of splitStatements(script)) {
      await env.DB.prepare(statement).run()
    }
  }
})

afterEach(() => {
  vi.unstubAllGlobals()
})

const TOKEN_A = "0x0000000000000000000000000000000000000aaa"
const TOKEN_B = "0x0000000000000000000000000000000000000bbb"

// A fake WEBSOCKET_HUB that never talks to a real DO — price-refresh tests
// only assert KV side effects and broadcast calls.
const makeStubHub = (): { hub: QueueEnv["WEBSOCKET_HUB"]; fetch: ReturnType<typeof vi.fn> } => {
  const fetch = vi.fn(async () => new Response("ok"))
  const hub = {
    idFromName: (name: string) => ({ name }),
    get: () => ({ fetch }),
  } as unknown as QueueEnv["WEBSOCKET_HUB"]
  return { hub, fetch }
}

const makeQueueEnv = (overrides: Partial<QueueEnv> = {}): QueueEnv & { hubFetch: ReturnType<typeof vi.fn> } => {
  const { hub, fetch: hubFetch } = makeStubHub()
  return {
    DB: env.DB,
    CACHE: env.CACHE,
    STORAGE: env.STORAGE,
    WEBSOCKET_HUB: hub,
    CHAIN_ID: "1",
    ...overrides,
    hubFetch,
  }
}

const makeBatch = (body: unknown) => {
  const ack = vi.fn()
  const retry = vi.fn()
  const batch = {
    messages: [{ id: "msg-1", timestamp: new Date(), attempts: 1, body, ack, retry }],
  } as unknown as MessageBatch<unknown>
  return { batch, ack, retry }
}

const stubCoinGecko = (price: number, opts: { hang?: boolean; url?: string } = {}): ReturnType<typeof vi.fn> => {
  const fetchMock = vi.fn((url: string, init?: RequestInit) => {
    if (opts.url !== undefined && url !== opts.url) {
      return Promise.resolve(new Response("{}", { status: 200 }))
    }
    if (opts.hang === true) {
      return new Promise<Response>((resolve) => {
        // Only ever resolves if the request is aborted — never on its own.
        init?.signal?.addEventListener("abort", () => {
          resolve(new Response("{}", { status: 500 }))
        })
      })
    }
    return Promise.resolve(new Response(JSON.stringify({ [TOKEN_A.toLowerCase()]: { usd: price } }), { status: 200 }))
  })
  vi.stubGlobal("fetch", fetchMock)
  return fetchMock
}

describe("fetchTokenPrice", () => {
  it("uses the CoinGecko platform matching the chain id, not hardcoded ethereum", async () => {
    const fetchMock = stubCoinGecko(3.5)
    await expect(fetchTokenPrice(TOKEN_A, "137", 5_000)).resolves.toBe(3.5)
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("token_price/polygon-pos"),
      expect.objectContaining({ signal: expect.anything() }),
    )
  })

  it("fails closed (returns 0) for chains CoinGecko has no platform for", async () => {
    const fetchMock = stubCoinGecko(3.5)
    await expect(fetchTokenPrice(TOKEN_A, "12345", 5_000)).resolves.toBe(0)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("aborts a hanging upstream fetch within the bounded timeout", async () => {
    stubCoinGecko(3.5, { hang: true })
    const started = Date.now()
    const price = await fetchTokenPrice(TOKEN_A, "1", 200)
    expect(price).toBe(0)
    expect(Date.now() - started).toBeLessThan(2_000)
  })
})

describe("handlePriceRefresh (via processQueueBatch)", () => {
  it("stores prices under chain-scoped KV keys and broadcasts valid prices", async () => {
    stubCoinGecko(3.5)
    const msg: PriceRefreshMessage = { type: "price-refresh", tokens: [TOKEN_A] }
    const { batch, ack, retry } = makeBatch(msg)
    const queueEnv = makeQueueEnv()

    await processQueueBatch(batch, queueEnv)

    const raw = await env.CACHE.get(`price:1:${TOKEN_A}`)
    expect(raw).not.toBeNull()
    expect(JSON.parse(raw as string)).toMatchObject({ tokenAddress: TOKEN_A, priceUsd: 3.5 })
    expect(await env.CACHE.get(`price:${TOKEN_A}`)).toBeNull()
    expect(queueEnv.hubFetch).toHaveBeenCalledTimes(1)
    expect(ack).toHaveBeenCalledTimes(1)
    expect(retry).not.toHaveBeenCalled()
  })

  it("continues to the next token when one fetch fails", async () => {
    const fetchMock = vi.fn((url: string) => {
      if (url.includes(TOKEN_A.toLowerCase())) {
        // Upstream failure for the first token (network error, not a hang).
        return Promise.reject(new TypeError("Failed to fetch"))
      }
      return Promise.resolve(new Response(JSON.stringify({ [TOKEN_B.toLowerCase()]: { usd: 7.25 } }), { status: 200 }))
    })
    vi.stubGlobal("fetch", fetchMock)

    const msg: PriceRefreshMessage = { type: "price-refresh", tokens: [TOKEN_A, TOKEN_B] }
    const { batch, ack } = makeBatch(msg)
    const queueEnv = makeQueueEnv()

    await processQueueBatch(batch, queueEnv)

    // Token A never produced a price (its fetch failed); token B still stored.
    const rawB = await env.CACHE.get(`price:1:${TOKEN_B}`)
    expect(JSON.parse(rawB as string)).toMatchObject({ priceUsd: 7.25 })
    expect(ack).toHaveBeenCalledTimes(1)
  })
})

describe("evaluateTpSlTrigger (four branch combinations)", () => {
  // X18-scaled prices: trigger at 1.0; DOWN values below it, UP values above it.
  const trigger = 1_000_000_000_000_000_000n
  const down = 500_000_000_000_000_000n
  const up = 2_000_000_000_000_000_000n

  const cases: ReadonlyArray<{
    name: string
    orderType: string
    zeroForOne: boolean
    spot: bigint
    twap: bigint
    expected: boolean
  }> = [
    {
      name: "TP zeroForOne: price went DOWN",
      orderType: "take_profit",
      zeroForOne: true,
      spot: down,
      twap: down - 1n,
      expected: true,
    },
    {
      name: "TP zeroForOne: price went UP",
      orderType: "take_profit",
      zeroForOne: true,
      spot: up,
      twap: up - 1n,
      expected: false,
    },
    {
      name: "TP !zeroForOne: price went UP",
      orderType: "take_profit",
      zeroForOne: false,
      spot: up,
      twap: up - 1n,
      expected: true,
    },
    {
      name: "TP !zeroForOne: price went DOWN",
      orderType: "take_profit",
      zeroForOne: false,
      spot: down,
      twap: down - 1n,
      expected: false,
    },
    {
      name: "SL zeroForOne: price went UP",
      orderType: "stop_loss",
      zeroForOne: true,
      spot: up,
      twap: up - 1n,
      expected: true,
    },
    {
      name: "SL zeroForOne: price went DOWN",
      orderType: "stop_loss",
      zeroForOne: true,
      spot: down,
      twap: down - 1n,
      expected: false,
    },
    {
      name: "SL !zeroForOne: price went DOWN",
      orderType: "stop_loss",
      zeroForOne: false,
      spot: down,
      twap: down - 1n,
      expected: true,
    },
    {
      name: "SL !zeroForOne: price went UP",
      orderType: "stop_loss",
      zeroForOne: false,
      spot: up,
      twap: up - 1n,
      expected: false,
    },
  ]

  it.each(cases)("$name → $expected", ({ orderType, zeroForOne, spot, twap, expected }) => {
    expect(
      evaluateTpSlTrigger({ orderType, zeroForOne, spotPrice: spot, twapPrice: twap, triggerPrice: trigger }),
    ).toBe(expected)
  })
})
