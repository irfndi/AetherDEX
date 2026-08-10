import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { Address } from "../../src/components/Address"
import { DexScreenerChart } from "../../src/components/DexScreenerChart"
import { TokenChip } from "../../src/components/TokenChip"

function getIframeSrc(container: HTMLElement): string {
  return (container.querySelector("iframe") as HTMLIFrameElement | null)?.src ?? ""
}

describe("Address", () => {
  it("truncates a long address", () => {
    render(<Address address="0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48" />)
    const el = screen.getByText("0xA0b8\u2026eB48")
    expect(el).toBeDefined()
    expect(el.title).toBe("0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48")
  })

  it("renders short address as-is", () => {
    render(<Address address="0x12" />)
    expect(screen.getByText("0x12")).toBeDefined()
  })

  it("renders empty address as-is", () => {
    const { container } = render(<Address address="" />)
    const spans = container.querySelectorAll("span")
    expect(spans.length).toBeGreaterThan(0)
    expect(spans[0]?.textContent).toBe("")
  })

  it("applies custom className", () => {
    const { container } = render(<Address address="0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48" className="custom" />)
    expect((container.firstChild as Element)?.className).toContain("custom")
  })

  it("applies mono font and full-address title to short addresses too", () => {
    const { container } = render(<Address address="0x12" />)
    const span = container.firstChild as HTMLElement
    expect(span.className).toContain("font-mono")
    expect(span.title).toBe("0x12")
  })

  it("honors a custom length", () => {
    render(<Address address="0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48" length={6} />)
    expect(screen.getByText("0xA0b869\u202606eB48")).toBeDefined()
  })

  it("clamps degenerate length values instead of expanding output", () => {
    const full = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48"
    for (const length of [0, -1, 2.5]) {
      const { container, unmount } = render(<Address address={full} length={length} />)
      const text = (container.firstChild as HTMLElement).textContent ?? ""
      expect(text).not.toBe("0x\u2026")
      expect(text.length).toBeLessThanOrEqual(full.length)
      expect(text).toContain("\u2026")
      unmount()
    }
  })
})

describe("TokenChip", () => {
  const mockToken = {
    address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
    symbol: "USDC",
    name: "USD Coin",
    decimals: 6,
  }

  it("renders token symbol and shortened address", () => {
    render(<TokenChip token={mockToken} />)
    expect(screen.getByText("USDC")).toBeDefined()
    expect(screen.getByText("0xA0b...B48")).toBeDefined()
  })

  it("renders logo when logoURI provided", () => {
    const tokenWithLogo = { ...mockToken, logoURI: "https://example.com/logo.png" }
    render(<TokenChip token={tokenWithLogo} />)
    const img = screen.getByRole("img", { name: "USDC" }) as HTMLImageElement
    expect(img.src).toBe("https://example.com/logo.png")
  })

  it("renders remove button when onRemove provided", () => {
    const onRemove = vi.fn()
    render(<TokenChip token={mockToken} onRemove={onRemove} />)
    const removeBtn = screen.getByRole("button", { name: "Remove USDC" })
    removeBtn.click()
    expect(onRemove).toHaveBeenCalledOnce()
  })

  it("does not render remove button when onRemove not provided", () => {
    render(<TokenChip token={mockToken} />)
    expect(screen.queryByRole("button", { name: "Remove USDC" })).toBeNull()
  })

  it("applies custom className", () => {
    const { container } = render(<TokenChip token={mockToken} className="extra" />)
    expect((container.firstElementChild as HTMLElement)?.className).toContain("extra")
  })

  it("rejects non-https logo URLs", () => {
    render(<TokenChip token={{ ...mockToken, logoURI: "http://example.com/logo.png" }} />)
    expect(screen.queryByRole("img")).toBeNull()
  })

  it("rejects non-http(s) logo schemes", () => {
    render(<TokenChip token={{ ...mockToken, logoURI: "ipfs://QmLogo" }} />)
    expect(screen.queryByRole("img")).toBeNull()
  })

  it("adds referrerPolicy to allowed logo images", () => {
    render(<TokenChip token={{ ...mockToken, logoURI: "https://example.com/logo.png" }} />)
    expect(screen.getByRole("img", { name: "USDC" }).getAttribute("referrerpolicy")).toBe("no-referrer")
  })

  it("falls back to a monogram when the logo fails to load", () => {
    const { container } = render(<TokenChip token={{ ...mockToken, logoURI: "https://example.com/logo.png" }} />)
    fireEvent.error(screen.getByRole("img", { name: "USDC" }))
    expect(screen.queryByRole("img")).toBeNull()
    expect(container.querySelector(".bg-base-300")?.textContent).toBe("U")
  })
})

describe("DexScreenerChart", () => {
  const ADDRESS = "0x1111111111111111111111111111111111111111"

  it("renders iframe with correct src for ethereum", () => {
    const { container } = render(<DexScreenerChart tokenAddress={ADDRESS} />)
    const src = getIframeSrc(container)
    expect(src).toContain(`dexscreener.com/ethereum/${ADDRESS}`)
    expect(src).toContain("embed=1")
  })

  it("uses correct chain name for base", () => {
    const { container } = render(<DexScreenerChart tokenAddress={ADDRESS} chainId={8453} />)
    expect(getIframeSrc(container)).toContain(`dexscreener.com/base/${ADDRESS}`)
  })

  it("uses correct chain name for sepolia", () => {
    const { container } = render(<DexScreenerChart tokenAddress={ADDRESS} chainId={11155111} />)
    expect(getIframeSrc(container)).toContain(`dexscreener.com/sepolia/${ADDRESS}`)
  })

  it("does not fall back to ethereum for an unsupported chain", () => {
    const { container } = render(<DexScreenerChart tokenAddress={ADDRESS} chainId={999} />)
    expect(container.querySelector("iframe")).toBeNull()
    expect(screen.getByText("Unsupported chain")).toBeDefined()
  })

  it("rejects a non-EVM token address", () => {
    const { container } = render(<DexScreenerChart tokenAddress="0xToken" theme="light" />)
    expect(container.querySelector("iframe")).toBeNull()
    expect(screen.getByText("Invalid token address")).toBeDefined()
  })

  it("applies custom className", () => {
    const { container } = render(<DexScreenerChart tokenAddress={ADDRESS} className="my-chart" />)
    expect((container.firstElementChild as HTMLElement)?.className).toContain("my-chart")
  })
})
