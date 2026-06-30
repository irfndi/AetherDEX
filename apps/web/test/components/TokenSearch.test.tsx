import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"
import { TokenSearch } from "../../src/components/TokenSearch"

describe("TokenSearch", () => {
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

  it("opens dropdown on button click and shows default tokens", async () => {
    const user = userEvent.setup()
    render(<TokenSearch onSelect={vi.fn()} />)
    await user.click(screen.getByText("Select token"))
    await waitFor(() => {
      expect(screen.getByText("ETH")).toBeDefined()
      expect(screen.getByText("USDC")).toBeDefined()
      expect(screen.getByText("USDT")).toBeDefined()
      expect(screen.getByText("DAI")).toBeDefined()
    })
  })

  it("filters tokens by symbol search", async () => {
    const user = userEvent.setup()
    render(<TokenSearch onSelect={vi.fn()} />)
    await user.click(screen.getByText("Select token"))
    const input = screen.getByPlaceholderText("Search token")
    await user.type(input, "ETH")
    await waitFor(() => {
      expect(screen.getByText("ETH")).toBeDefined()
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
      expect(screen.queryByText("ETH")).toBeNull()
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
      expect(screen.getByText("ETH")).toBeDefined()
    })
    await user.click(screen.getByText("ETH"))
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ symbol: "ETH", name: "Ether" }))
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

  it("filters by address match", async () => {
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
      expect(screen.getByText("ETH")).toBeDefined()
    })
    await user.click(screen.getByText("Outside"))
    await waitFor(() => {
      expect(screen.queryByText("ETH")).toBeNull()
    })
  })
})
