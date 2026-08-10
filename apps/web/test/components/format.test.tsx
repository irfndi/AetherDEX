import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, waitFor } from "@testing-library/react"
import type { ReactNode } from "react"
import { describe, expect, it, vi } from "vitest"
import { Address } from "../../src/components/Address"
import { PoolStats } from "../../src/components/PoolStats"
import { PriceTicker } from "../../src/components/PriceTicker"
import { RangeSelector } from "../../src/components/RangeSelector"
import { useWebSocket } from "../../src/hooks/useWebSocket"

vi.mock("../../src/hooks/useWebSocket", () => ({
  useWebSocket: vi.fn(),
}))

function renderWithQuery(ui: ReactNode) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>)
}

function priceFrame(price: number, extra: Record<string, number> = {}) {
  return {
    data: { type: "price", data: { tokenAddress: "0xToken", price, ...extra } },
    isConnected: true,
    error: undefined,
    reconnectCount: 0,
  }
}

describe("formatPrice", () => {
  it("formats a zero price", async () => {
    vi.mocked(useWebSocket).mockReturnValue(priceFrame(0))
    render(<PriceTicker tokenAddress="0xToken" />)
    await waitFor(() => expect(screen.getByText("$0.00")).toBeDefined())
  })

  it("formats a sub-cent price with significant digits", async () => {
    vi.mocked(useWebSocket).mockReturnValue(priceFrame(0.001))
    render(<PriceTicker tokenAddress="0xToken" />)
    await waitFor(() => expect(screen.getByText("$0.001000")).toBeDefined())
  })

  it("formats a negative price as zero", async () => {
    vi.mocked(useWebSocket).mockReturnValue(priceFrame(-5))
    render(<PriceTicker tokenAddress="0xToken" />)
    await waitFor(() => expect(screen.getByText("$0.00")).toBeDefined())
  })
})

describe("formatVolume", () => {
  it("formats volumes in millions", async () => {
    vi.mocked(useWebSocket).mockReturnValue(priceFrame(1, { volume24h: 1_200_000 }))
    render(<PriceTicker tokenAddress="0xToken" showVolume />)
    await waitFor(() => expect(screen.getByText("Vol $1.20M")).toBeDefined())
  })
})

describe("formatUsd", () => {
  const TOKEN = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48"
  const PAIR = {
    chainId: "ethereum",
    dexId: "test",
    pairAddress: "0x1000000000000000000000000000000000000001",
    baseToken: { address: "0x1", name: "Base", symbol: "BASE" },
    quoteToken: { address: "0x2", name: "Quote", symbol: "QUOTE" },
    priceNative: "1",
    priceUsd: "2",
    volume: { h24: 5_000_000, h6: 0, h1: 0 },
    priceChange: { h24: 0, h6: 0, h1: 0 },
    liquidity: { usd: 2_000_000, base: 1, quote: 1 },
    fdv: 0,
    marketCap: 0,
  }

  it("formats liquidity values in millions", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ pairs: [PAIR] }), { status: 200 })))
    renderWithQuery(<PoolStats tokenAddress={TOKEN} />)

    await waitFor(() => expect(screen.getByText("$2.00M")).toBeDefined())
    expect(screen.getByText("$5.00M")).toBeDefined()
  })

  it("renders the unavailable state for an empty pairs list", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ pairs: [] }), { status: 200 })))
    renderWithQuery(<PoolStats tokenAddress={TOKEN} />)

    await waitFor(() => expect(screen.getByText("No pool data available for this token.")).toBeDefined())
  })
})

describe("Address", () => {
  const LONG = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48"

  it.each([0, 1, 4])("renders fewer characters than the input when length is %i", (length) => {
    render(<Address address={LONG} length={length} />)
    const el = screen.getByText(/0xA/)
    expect(el.textContent?.length ?? 0).toBeLessThan(LONG.length)
  })
})

describe("RangeSelector", () => {
  it("keeps lower <= upper even when the props are inverted", () => {
    const onChange = vi.fn()
    render(<RangeSelector currentTick={0} tickSpacing={10} lowerTick={200} upperTick={-200} onChange={onChange} />)

    const lower = screen.getByLabelText("Lower tick range handle") as HTMLInputElement
    const upper = screen.getByLabelText("Upper tick range handle") as HTMLInputElement
    expect(Number(lower.value)).toBeLessThanOrEqual(Number(upper.value))
    expect(screen.getByText("Lower 200")).toBeDefined()
    expect(screen.getByText("Upper 210")).toBeDefined()
    expect(screen.getByText("Step 10")).toBeDefined()
  })
})
