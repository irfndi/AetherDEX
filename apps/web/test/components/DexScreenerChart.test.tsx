import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { DexScreenerChart } from "../../src/components/DexScreenerChart"

const ADDRESS = "0x1111111111111111111111111111111111111111"

describe("DexScreenerChart", () => {
  it("builds the dexscreener embed URL for the default chain and theme", () => {
    const { container } = render(<DexScreenerChart tokenAddress={ADDRESS} />)
    expect(container.querySelector("iframe")?.getAttribute("src")).toBe(
      `https://dexscreener.com/ethereum/${ADDRESS}?embed=1&theme=dark&chart=smart&chartType=mc`,
    )
  })

  it("maps each supported chainId to its chain slug", () => {
    const cases: Array<[number, string]> = [
      [1, "ethereum"],
      [8453, "base"],
      [11155111, "sepolia"],
      [84532, "base-sepolia"],
    ]
    for (const [chainId, slug] of cases) {
      const { container, unmount } = render(<DexScreenerChart tokenAddress={ADDRESS} chainId={chainId} theme="light" />)
      expect(container.querySelector("iframe")?.getAttribute("src")).toBe(
        `https://dexscreener.com/${slug}/${ADDRESS}?embed=1&theme=light&chart=smart&chartType=mc`,
      )
      unmount()
    }
  })

  it("renders an error state instead of an iframe for an unknown chainId", () => {
    const { container } = render(<DexScreenerChart tokenAddress={ADDRESS} chainId={137} />)
    expect(container.querySelector("iframe")).toBeNull()
    expect(screen.getByText("Unsupported chain")).toBeDefined()
  })

  it("rejects a tokenAddress containing URL-injection characters", () => {
    const { container } = render(<DexScreenerChart tokenAddress={`${ADDRESS.slice(0, 8)}?embed=0&theme=light`} />)
    expect(container.querySelector("iframe")).toBeNull()
    expect(screen.getByText("Invalid token address")).toBeDefined()
  })

  it("merges className onto the wrapper and passes rest props to the iframe", () => {
    const { container } = render(<DexScreenerChart tokenAddress={ADDRESS} className="custom" data-testid="embed" />)
    const wrapper = container.firstElementChild as HTMLElement
    expect(wrapper.className).toContain("custom")
    expect(container.querySelector("iframe")?.getAttribute("data-testid")).toBe("embed")
  })

  it("sets a descriptive title on the iframe", () => {
    const { container } = render(<DexScreenerChart tokenAddress={ADDRESS} />)
    expect(container.querySelector("iframe")?.getAttribute("title")).toBe(`DexScreener chart for ${ADDRESS}`)
  })
})
