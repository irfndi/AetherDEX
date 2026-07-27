import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import type { ReactNode } from "react"
import { describe, expect, it, vi } from "vitest"
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

describe("RangeSelector", () => {
  it("snaps handles to spacing and reports a lower-range change", () => {
    const onChange = vi.fn()
    render(
      <RangeSelector
        currentTick={100}
        tickSpacing={10}
        lowerTick={83}
        upperTick={127}
        liquidityDistribution={[25, 50, 75]}
        onChange={onChange}
      />,
    )

    expect(screen.getByText("Lower 80")).toBeDefined()
    expect(screen.getByText("Upper 130")).toBeDefined()
    expect(screen.getByRole("img", { name: "Pool liquidity depth" })).toBeDefined()

    fireEvent.change(screen.getByLabelText("Lower tick range handle"), { target: { value: "90" } })
    expect(onChange).toHaveBeenCalledWith({ lowerTick: 90, upperTick: 130 })
  })

  it("renders the missing-depth state and preserves the minimum range width", () => {
    const onChange = vi.fn()
    render(<RangeSelector currentTick={0} tickSpacing={0} lowerTick={0} upperTick={0} onChange={onChange} />)

    expect(screen.getByText("Pool depth data unavailable")).toBeDefined()
    fireEvent.change(screen.getByLabelText("Upper tick range handle"), { target: { value: "10" } })
    expect(onChange).toHaveBeenCalledWith({ lowerTick: 0, upperTick: 10 })
  })
})

describe("PoolStats", () => {
  it("selects the highest-liquidity pair for the requested chain", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            pairs: [
              {
                chainId: "ethereum",
                dexId: "low",
                pairAddress: "0x1000000000000000000000000000000000000001",
                baseToken: { address: "0x1", name: "Base", symbol: "BASE" },
                quoteToken: { address: "0x2", name: "Quote", symbol: "QUOTE" },
                priceNative: "1",
                priceUsd: "2",
                volume: { h24: 100, h6: 10, h1: 1 },
                priceChange: { h24: 1.5, h6: 0, h1: 0 },
                liquidity: { usd: 100, base: 1, quote: 1 },
                fdv: 0,
                marketCap: 0,
              },
              {
                chainId: "ethereum",
                dexId: "high",
                pairAddress: "0x2000000000000000000000000000000000000002",
                baseToken: { address: "0x1", name: "Base", symbol: "BASE" },
                quoteToken: { address: "0x2", name: "Quote", symbol: "QUOTE" },
                priceNative: "1",
                priceUsd: "3",
                volume: { h24: 2_000, h6: 10, h1: 1 },
                priceChange: { h24: -2.5, h6: 0, h1: 0 },
                liquidity: { usd: 2_000, base: 1, quote: 1 },
                fdv: 0,
                marketCap: 0,
              },
            ],
          }),
          { status: 200 },
        ),
      ),
    )

    renderWithQuery(<PoolStats tokenAddress="0xToken" chainId={1} />)

    await waitFor(() => expect(screen.getByText("BASE / QUOTE")).toBeDefined())
    expect(screen.getAllByText("$2.0K")).toHaveLength(2)
    expect(screen.getByText("-2.50%")).toBeDefined()
  })

  it("renders the unavailable state when the API fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("", { status: 503 })))
    renderWithQuery(<PoolStats tokenAddress="0xToken" />)

    await waitFor(() => expect(screen.getByText("No pool data available for this token.")).toBeDefined())
  })
})

describe("PriceTicker", () => {
  it("renders the connected price, trend, and volume", async () => {
    vi.mocked(useWebSocket).mockReturnValue({
      data: { type: "price", data: { tokenAddress: "0xToken", price: 12.3456, change24h: 4.5, volume24h: 1_200 } },
      isConnected: true,
      error: undefined,
      reconnectCount: 0,
    })

    render(<PriceTicker tokenAddress="0xToken" showVolume />)

    await waitFor(() => expect(screen.getByText("$12.3456")).toBeDefined())
    expect(screen.getByText("+4.50%")).toBeDefined()
    expect(screen.getByText("Vol $1.2K")).toBeDefined()
  })

  it("renders a connection failure when no price is available", () => {
    vi.mocked(useWebSocket).mockReturnValue({
      data: null,
      isConnected: false,
      error: "offline",
      reconnectCount: 0,
    })

    render(<PriceTicker tokenAddress="0xToken" />)

    expect(screen.getByText("Connection failed")).toBeDefined()
  })

  it("ignores a price frame for another token", () => {
    vi.mocked(useWebSocket).mockReturnValue({
      data: { type: "price", data: { tokenAddress: "0xOther", price: 12.3456 } },
      isConnected: true,
      error: undefined,
      reconnectCount: 0,
    })

    render(<PriceTicker tokenAddress="0xToken" />)

    expect(screen.getByText("—")).toBeDefined()
  })
})
