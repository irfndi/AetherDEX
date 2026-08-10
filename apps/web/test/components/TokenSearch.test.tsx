import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { TokenSearch } from "../../src/components/TokenSearch"

// Canonical-list shaped fixtures (what the API serves after validating the
// Uniswap default token list: schema + EIP-55 checksums + chainId filter).
const USDC = {
  chainId: 1,
  address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
  symbol: "USDC",
  name: "USD Coin",
  decimals: 6,
  logoUrl: null,
  isVerified: true,
  isNative: false,
  totalSupply: null,
  createdAt: 1719715200,
  updatedAt: 1719715200,
}
const WETH = {
  chainId: 1,
  address: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
  symbol: "WETH",
  name: "Wrapped Ether",
  decimals: 18,
  logoUrl: null,
  isVerified: true,
  isNative: false,
  totalSupply: null,
  createdAt: 1719715200,
  updatedAt: 1719715200,
}
const USDT = { ...WETH, address: "0xdAC17F958D2ee523a2206206994597C13D831ec7", symbol: "USDT", name: "Tether USD" }
const DAI = {
  ...WETH,
  address: "0x6B175474E89094C44Da98b954EedeAC495271d0F",
  symbol: "DAI",
  name: "Dai Stablecoin",
}
const LIST = [USDC, WETH, USDT, DAI]

function mockTokensApi() {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    const byAddress = /\/tokens\/(0x[a-fA-F0-9]{40})/.exec(url)
    if (byAddress) {
      const found = LIST.find((t) => t.address.toLowerCase() === byAddress[1]?.toLowerCase())
      return {
        ok: Boolean(found),
        status: found ? 200 : 404,
        json: async () => ({ token: found }),
      }
    }
    const search = new URL(url).searchParams.get("search") ?? ""
    const q = search.toLowerCase()
    const tokens = q ? LIST.filter((t) => t.symbol.toLowerCase().includes(q) || t.name.toLowerCase().includes(q)) : LIST
    return { ok: true, status: 200, json: async () => ({ tokens, count: tokens.length }) }
  })
}

describe("TokenSearch", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", mockTokensApi())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("renders with default placeholder", () => {
    render(<TokenSearch onSelect={vi.fn()} />)
    expect(screen.getByPlaceholderText("Search token")).toBeDefined()
  })

  it("renders with custom placeholder", () => {
    render(<TokenSearch onSelect={vi.fn()} placeholder="Select token" />)
    expect(screen.getByPlaceholderText("Select token")).toBeDefined()
  })

  it("shows select token button when no token selected", () => {
    render(<TokenSearch onSelect={vi.fn()} />)
    expect(screen.getByText("Select token")).toBeDefined()
  })

  it("opens dropdown and shows tokens from the default list endpoint", async () => {
    const user = userEvent.setup()
    render(<TokenSearch onSelect={vi.fn()} />)
    await user.click(screen.getByText("Select token"))
    await waitFor(() => {
      expect(screen.getByText("USDC")).toBeDefined()
      expect(screen.getByText("WETH")).toBeDefined()
      expect(screen.getByText("USDT")).toBeDefined()
      expect(screen.getByText("DAI")).toBeDefined()
    })
  })

  it("filters tokens by symbol search", async () => {
    const user = userEvent.setup()
    render(<TokenSearch onSelect={vi.fn()} />)
    await user.click(screen.getByText("Select token"))
    const input = screen.getByPlaceholderText("Search token")
    await user.type(input, "WETH")
    await waitFor(() => {
      expect(screen.getByText("WETH")).toBeDefined()
      expect(screen.queryByText("USDC")).toBeNull()
    })
  })

  it("filters tokens by name search", async () => {
    const user = userEvent.setup()
    render(<TokenSearch onSelect={vi.fn()} />)
    await user.click(screen.getByText("Select token"))
    const input = screen.getByPlaceholderText("Search token")
    await user.type(input, "Tether")
    await waitFor(() => {
      expect(screen.getByText("USDT")).toBeDefined()
      expect(screen.queryByText("WETH")).toBeNull()
    })
  })

  it("shows no tokens found for unmatched query", async () => {
    const user = userEvent.setup()
    render(<TokenSearch onSelect={vi.fn()} />)
    await user.click(screen.getByText("Select token"))
    const input = screen.getByPlaceholderText("Search token")
    await user.type(input, "ZZZZZ")
    await waitFor(() => {
      expect(screen.getByText("No tokens found")).toBeDefined()
    })
  })

  it("calls onSelect when token is clicked", async () => {
    const onSelect = vi.fn()
    const user = userEvent.setup()
    render(<TokenSearch onSelect={onSelect} />)
    await user.click(screen.getByText("Select token"))
    await waitFor(() => {
      expect(screen.getByText("USDC")).toBeDefined()
    })
    await user.click(screen.getByText("USDC"))
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ symbol: "USDC", name: "USD Coin" }))
  })

  it("shows selected token symbol in button", () => {
    const ethToken = {
      address: "0x0000000000000000000000000000000000000000",
      symbol: "ETH",
      name: "Ether",
      decimals: 18,
    }
    render(<TokenSearch onSelect={vi.fn()} selectedToken={ethToken} />)
    expect(screen.getByText("ETH")).toBeDefined()
  })

  it("resolves a pasted address via the single-token endpoint", async () => {
    const user = userEvent.setup()
    render(<TokenSearch onSelect={vi.fn()} />)
    await user.click(screen.getByText("Select token"))
    const input = screen.getByPlaceholderText("Search token")
    await user.type(input, "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48")
    await waitFor(() => {
      expect(screen.getByText("USDC")).toBeDefined()
    })
  })

  it("closes dropdown on outside click", async () => {
    const user = userEvent.setup()
    render(
      <div>
        <TokenSearch onSelect={vi.fn()} />
        <button type="button">Outside</button>
      </div>,
    )
    await user.click(screen.getByText("Select token"))
    await waitFor(() => {
      expect(screen.getByText("USDC")).toBeDefined()
    })
    await user.click(screen.getByText("Outside"))
    await waitFor(() => {
      expect(screen.queryByText("USDC")).toBeNull()
    })
  })

  it("ignores stale in-flight responses when a newer query supersedes them", async () => {
    const pending = new Map<string, (value: unknown) => void>()
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      const byAddress = /\/tokens\/(0x[a-fA-F0-9]{40})/.exec(url)
      if (byAddress) {
        const found = LIST.find((t) => t.address.toLowerCase() === byAddress[1]?.toLowerCase())
        return {
          ok: Boolean(found),
          status: found ? 200 : 404,
          json: async () => ({ token: found }),
        }
      }
      const search = new URL(url).searchParams.get("search")
      if (!search) {
        // Default-list request — resolve immediately with no tokens.
        return { ok: true, status: 200, json: async () => ({ tokens: [], count: 0 }) }
      }
      return new Promise((resolve) => {
        pending.set(search, resolve)
      })
    })
    vi.stubGlobal("fetch", fetchMock)

    const user = userEvent.setup()
    render(<TokenSearch onSelect={vi.fn()} />)
    await user.click(screen.getByText("Select token"))
    const input = screen.getByPlaceholderText("Search token")

    await user.type(input, "US")
    await waitFor(() => expect(pending.has("US")).toBe(true))
    await user.type(input, "D")
    await waitFor(() => expect(pending.has("USD")).toBe(true))

    // Resolve the newest query first, then the stale one — the late "US"
    // response must not overwrite the newer "USD" results.
    pending.get("USD")?.({ ok: true, status: 200, json: async () => ({ tokens: [USDT], count: 1 }) })
    await waitFor(() => expect(screen.getByText("USDT")).toBeDefined())

    pending.get("US")?.({ ok: true, status: 200, json: async () => ({ tokens: [WETH], count: 1 }) })
    await waitFor(() => expect(screen.queryByText("WETH")).toBeNull())
    expect(screen.getByText("USDT")).toBeDefined()
  })

  it("does not render an image for a selected token with an untrusted logo host", () => {
    const unsafeToken = {
      address: "0x0000000000000000000000000000000000000000",
      symbol: "ETH",
      name: "Ether",
      decimals: 18,
      logoURI: "https://untrusted.example/x.png",
    }
    render(<TokenSearch onSelect={vi.fn()} selectedToken={unsafeToken} />)
    expect(screen.getByText("ETH")).toBeDefined()
    expect(screen.queryByRole("img")).toBeNull()
  })

  it("renders an image for a selected token with an allowed logo host", () => {
    const safeToken = {
      address: "0x0000000000000000000000000000000000000000",
      symbol: "ETH",
      name: "Ether",
      decimals: 18,
      logoURI: "https://assets.coingecko.com/coins/images/279/eth.png",
    }
    render(<TokenSearch onSelect={vi.fn()} selectedToken={safeToken} />)
    expect(screen.getByRole("img", { name: "ETH" })).toBeDefined()
  })

  it("trims leading and trailing whitespace from the search query", async () => {
    const user = userEvent.setup()
    render(<TokenSearch onSelect={vi.fn()} />)
    await user.click(screen.getByText("Select token"))
    const input = screen.getByPlaceholderText("Search token")
    await user.type(input, " WETH ")
    await waitFor(() => {
      expect(screen.getByText("WETH")).toBeDefined()
      expect(screen.queryByText("USDC")).toBeNull()
    })
  })

  it("retries the default list on reopen after a fetch failure", async () => {
    const fetchMock = vi.mocked(fetch)
    fetchMock.mockRejectedValueOnce(new Error("network down"))
    const user = userEvent.setup()
    render(
      <div>
        <TokenSearch onSelect={vi.fn()} />
        <button type="button">Outside</button>
      </div>,
    )
    await user.click(screen.getByText("Select token"))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    expect(screen.queryByText("USDC")).toBeNull()

    await user.click(screen.getByText("Outside")) // close
    await user.click(screen.getByText("Select token")) // reopen → retry
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(screen.getByText("USDC")).toBeDefined())
  })

  it("clears results and the spinner when the search request fails", async () => {
    const user = userEvent.setup()
    render(<TokenSearch onSelect={vi.fn()} />)
    await user.click(screen.getByText("Select token"))
    await waitFor(() => expect(screen.getByText("USDC")).toBeDefined())

    vi.mocked(fetch).mockRejectedValueOnce(new Error("network down"))
    const input = screen.getByPlaceholderText("Search token")
    await user.type(input, "WETH")
    await waitFor(() => expect(screen.getByText("No tokens found")).toBeDefined())
    expect(screen.queryByText("Searching...")).toBeNull()
    expect(screen.queryByText("WETH")).toBeNull()
  })

  it("shows no tokens found for an unknown pasted address", async () => {
    const user = userEvent.setup()
    render(<TokenSearch onSelect={vi.fn()} />)
    await user.click(screen.getByText("Select token"))
    const input = screen.getByPlaceholderText("Search token")
    await user.type(input, "0x1111111111111111111111111111111111111111")
    await waitFor(() => expect(screen.getByText("No tokens found")).toBeDefined())
  })

  it("drops a search response that lands after the input was cleared", async () => {
    const pending = new Map<string, (value: unknown) => void>()
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      const search = new URL(url).searchParams.get("search")
      if (!search) {
        // Default-list request — resolve immediately with no tokens.
        return { ok: true, status: 200, json: async () => ({ tokens: [], count: 0 }) }
      }
      const { promise, resolve } = Promise.withResolvers<unknown>()
      pending.set(search, resolve)
      return promise
    })
    vi.stubGlobal("fetch", fetchMock)

    const user = userEvent.setup()
    render(<TokenSearch onSelect={vi.fn()} />)
    await user.click(screen.getByText("Select token"))
    const input = screen.getByPlaceholderText("Search token")
    await user.type(input, "WETH")
    await waitFor(() => expect(pending.has("WETH")).toBe(true))

    await user.clear(input)
    pending.get("WETH")?.({ ok: true, status: 200, json: async () => ({ tokens: [WETH], count: 1 }) })

    await waitFor(() => {
      expect(screen.queryByText("WETH")).toBeNull()
      expect(screen.queryByText("Searching...")).toBeNull()
    })
  })
})
