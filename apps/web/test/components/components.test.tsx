import { render, screen } from "@testing-library/react"
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
})

describe("DexScreenerChart", () => {
  it("renders iframe with correct src for ethereum", () => {
    const { container } = render(<DexScreenerChart tokenAddress="0xToken123" />)
    const src = getIframeSrc(container)
    expect(src).toContain("dexscreener.com/ethereum/0xToken123")
    expect(src).toContain("embed=1")
  })

  it("uses correct chain name for base", () => {
    const { container } = render(<DexScreenerChart tokenAddress="0xToken123" chainId={8453} />)
    expect(getIframeSrc(container)).toContain("dexscreener.com/base/0xToken123")
  })

  it("uses correct chain name for sepolia", () => {
    const { container } = render(<DexScreenerChart tokenAddress="0xToken123" chainId={11155111} />)
    expect(getIframeSrc(container)).toContain("dexscreener.com/sepolia/0xToken123")
  })

  it("uses ethereum as fallback for unknown chain", () => {
    const { container } = render(<DexScreenerChart tokenAddress="0xToken123" chainId={999} />)
    expect(getIframeSrc(container)).toContain("dexscreener.com/ethereum/0xToken123")
  })

  it("applies theme parameter", () => {
    const { container } = render(<DexScreenerChart tokenAddress="0xToken" theme="light" />)
    expect(getIframeSrc(container)).toContain("theme=light")
  })

  it("applies custom className", () => {
    const { container } = render(<DexScreenerChart tokenAddress="0xToken" className="my-chart" />)
    expect((container.firstElementChild as HTMLElement)?.className).toContain("my-chart")
  })
})
