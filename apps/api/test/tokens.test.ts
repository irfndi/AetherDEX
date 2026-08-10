import { env } from "cloudflare:test"
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import m0001 from "../migrations/0001_initial_schema.sql?raw"
import m0002 from "../migrations/0002_seed_data.sql?raw"
import m0003 from "../migrations/0003_chain_scoped_tokens.sql?raw"
import m0004 from "../migrations/0004_phase1_chain_and_events.sql?raw"
import m0005 from "../migrations/0005_chain_qualified_pool_keys.sql?raw"
import m0006 from "../migrations/0006_chain_qualified_price_cache.sql?raw"
import m0007 from "../migrations/0007_v3_indexer_cursor.sql?raw"
import { tokens } from "../src/routes/tokens"

const MIGRATIONS = [m0001, m0002, m0003, m0004, m0005, m0006, m0007]

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
  await env.DB.prepare("PRAGMA foreign_keys = OFF").run()
})

const DAI = "0x6B175474E89094C44Da98b954EedeAC495271d0F"
const WETH = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2"
const LIST_URL = "https://tokens.aetherdex.test/list.json"

const TOKEN_LIST_DOC = {
  name: "Test List",
  tokens: [
    {
      chainId: 1,
      address: DAI,
      name: "Dai Stablecoin",
      symbol: "DAI",
      decimals: 18,
      logoURI: "https://example.test/dai.png",
    },
    {
      chainId: 1,
      address: WETH,
      name: "Wrapped Ether",
      symbol: "WETH",
      decimals: 18,
    },
    {
      chainId: 11155111,
      address: DAI,
      name: "Wrong chain DAI",
      symbol: "DAI",
      decimals: 18,
    },
  ],
}

const testEnv = (): Env => ({ ...env, CHAIN_ID: "1", TOKEN_LIST_URL: LIST_URL }) as unknown as Env

const stubTokenList = () =>
  vi.fn(async (input: RequestInfo | URL) => {
    if (String(input) === LIST_URL) return Response.json(TOKEN_LIST_DOC)
    return Response.json({ error: "not found" }, { status: 404 })
  })

beforeEach(async () => {
  await env.CACHE.delete("token-list:v1:chain:1").catch(() => undefined)
  await env.DB.prepare("DELETE FROM tokens WHERE chain_id = 1").run()
})

describe("GET /api/v1/tokens/:address", () => {
  afterEach(() => vi.unstubAllGlobals())

  it("rejects malformed addresses with 400", async () => {
    for (const address of ["0x123", "not-an-address", `0x${"0".repeat(41)}`]) {
      const response = await tokens.request(`/${address}`, undefined, testEnv())
      expect(response.status).toBe(400)
      expect(await response.json()).toEqual({ error: "Invalid token address" })
    }
  })

  it("returns a listed token for its checksummed address", async () => {
    vi.stubGlobal("fetch", stubTokenList())
    const response = await tokens.request(`/${DAI}`, undefined, testEnv())
    expect(response.status).toBe(200)
    const body = (await response.json()) as { token: { address: string; symbol: string; chainId: number } }
    expect(body.token.address).toBe(DAI)
    expect(body.token.symbol).toBe("DAI")
    expect(body.token.chainId).toBe(1)
  })

  it("normalizes the lowercase form of a listed token to its canonical entry", async () => {
    vi.stubGlobal("fetch", stubTokenList())
    const response = await tokens.request(`/${DAI.toLowerCase()}`, undefined, testEnv())
    expect(response.status).toBe(200)
    const body = (await response.json()) as { token: { address: string } }
    expect(body.token.address).toBe(DAI)
  })

  it("normalizes a non-checksummed mixed-case form to its canonical entry", async () => {
    vi.stubGlobal("fetch", stubTokenList())
    const brokenChecksum = `0x6b175474E89094C44Da98b954EedeAC495271d0F`
    const response = await tokens.request(`/${brokenChecksum}`, undefined, testEnv())
    expect(response.status).toBe(200)
    const body = (await response.json()) as { token: { address: string } }
    expect(body.token.address).toBe(DAI)
  })

  it("returns 404 for a checksum-valid but unlisted address", async () => {
    vi.stubGlobal("fetch", stubTokenList())
    const response = await tokens.request("/0x1111111111111111111111111111111111111111", undefined, testEnv())
    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ error: "Token not found" })
  })

  it("returns a generic 500 without leaking internals when the token list fetch fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("Token list HTTP 500 from https://tokens.aetherdex.test")
      }),
    )
    const response = await tokens.request(`/${DAI}`, undefined, testEnv())
    expect(response.status).toBe(500)
    const body = (await response.json()) as { error: string }
    expect(body.error).toBe("Internal server error")
    expect(JSON.stringify(body)).not.toContain("tokens.aetherdex.test")
    expect(JSON.stringify(body)).not.toContain("TokenListError")
  })
})
