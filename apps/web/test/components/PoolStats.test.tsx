import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen } from "@testing-library/react"
import type { ReactNode } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { PoolStats } from "../../src/components/PoolStats"

const VALID_ADDRESS = "0x1f9840a85d5af5bf1d1762f925bdaddc4201f984"

function renderWithQuery(ui: ReactNode) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>)
}

function makePair(chainId: string, symbol: string, pairAddress: string, liquidityUsd: number) {
  return {
    chainId,
    dexId: "uniswap-v2",
    url: `https://dex.example/pair/${symbol}`,
    pairAddress,
    baseToken: { address: "0xbase", name: symbol, symbol },
    quoteToken: { address: "0xquote", name: "USDC", symbol: "USDC" },
    priceNative: "1",
    priceUsd: "1.5",
    volume: { h24: 1000, h6: 100, h1: 10 },
    priceChange: { h24: 1, h6: 0.5, h1: 0.1 },
    liquidity: { usd: liquidityUsd, base: 1, quote: 1 },
    fdv: 1000,
    marketCap: 1000,
  }
}

function stubDexScreener(pairs: unknown) {
  const fetchMock = vi.fn().mockResolvedValue(
    new Response(JSON.stringify({ schemaVersion: "1.0.0", pairs }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }),
  )
  vi.stubGlobal("fetch", fetchMock)
  return fetchMock
}

describe("PoolStats", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("shows a loading state while fetching", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise<Response>(() => {})),
    )
    renderWithQuery(<PoolStats tokenAddress={VALID_ADDRESS} />)
    expect(await screen.findByText("Loading pool stats…")).toBeDefined()
  })

  it("renders the empty state when the API returns pairs: null", async () => {
    const fetchMock = stubDexScreener(null)
    renderWithQuery(<PoolStats tokenAddress={VALID_ADDRESS} />)
    expect(await screen.findByText("No pool data available for this token.")).toBeDefined()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it("renders the empty state for an empty pair list", async () => {
    stubDexScreener([])
    renderWithQuery(<PoolStats tokenAddress={VALID_ADDRESS} />)
    expect(await screen.findByText("No pool data available for this token.")).toBeDefined()
  })

  it("selects the highest-liquidity pair on the mapped chain", async () => {
    stubDexScreener([
      makePair("ethereum", "ETHPAIR", "0x1", 100),
      makePair("base", "BASELOW", "0x2", 200),
      makePair("base", "BASEHIGH", "0x3", 500),
    ])
    renderWithQuery(<PoolStats tokenAddress={VALID_ADDRESS} chainId={8453} />)
    expect(await screen.findByText("BASEHIGH / USDC")).toBeDefined()
  })

  it("does not silently filter to ethereum for unmapped chainIds", async () => {
    stubDexScreener([makePair("ethereum", "ETHPAIR", "0x1", 100), makePair("polygon", "POLYGONHIGH", "0x2", 500)])
    renderWithQuery(<PoolStats tokenAddress={VALID_ADDRESS} chainId={137} />)
    expect(await screen.findByText("POLYGONHIGH / USDC")).toBeDefined()
  })

  it("skips the network request when the token address is invalid", async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)
    renderWithQuery(<PoolStats tokenAddress="0xabc/def?x=1" />)
    expect(await screen.findByText("No pool data available for this token.")).toBeDefined()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("passes react-query's abort signal to fetch", async () => {
    const fetchMock = stubDexScreener(null)
    renderWithQuery(<PoolStats tokenAddress={VALID_ADDRESS} />)
    await screen.findByText("No pool data available for this token.")
    const [url, init] = fetchMock.mock.calls[0] ?? []
    expect(String(url)).toBe(`https://api.dexscreener.com/latest/dex/tokens/${VALID_ADDRESS}`)
    expect(init?.signal).toBeInstanceOf(AbortSignal)
  })
})
