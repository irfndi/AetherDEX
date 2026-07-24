import { render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import {
  formatPositionValue,
  getPortfolioStatus,
  type PortfolioPosition,
  PortfolioResults,
} from "../../src/routes/portfolio"

const position: PortfolioPosition = {
  id: 7,
  poolId: "0xpool-id",
  tickLower: -120,
  tickUpper: 120,
  liquidity: "1000000000000",
  amount0: "2500000",
  amount1: "3500000",
  feesEarnedToken0: "1250",
  feesEarnedToken1: "875",
}

describe("portfolio helpers", () => {
  it("formats reported values without inventing a fallback amount", () => {
    expect(formatPositionValue("2500000")).toBe("2500000")
    expect(formatPositionValue("  ")).toBe("Not reported")
  })

  it("prioritizes wallet and request status before empty or ready", () => {
    expect(getPortfolioStatus({ isConnected: false, isPending: true, isError: true, positionCount: 2 })).toBe(
      "disconnected",
    )
    expect(getPortfolioStatus({ isConnected: true, isPending: true, isError: false, positionCount: 0 })).toBe("loading")
    expect(getPortfolioStatus({ isConnected: true, isPending: false, isError: true, positionCount: 0 })).toBe("error")
    expect(getPortfolioStatus({ isConnected: true, isPending: false, isError: false, positionCount: 0 })).toBe("empty")
    expect(getPortfolioStatus({ isConnected: true, isPending: false, isError: false, positionCount: 1 })).toBe("ready")
  })
})

describe("PortfolioResults", () => {
  it("renders position details and labels PnL as unavailable without cost basis", () => {
    render(
      <PortfolioResults
        errorMessage={null}
        isConnected
        isError={false}
        isPending={false}
        onConnect={vi.fn()}
        onRetry={vi.fn()}
        positions={[position]}
      />,
    )

    expect(screen.getByText("0xpool-id")).toBeDefined()
    expect(screen.getByText("-120 to 120")).toBeDefined()
    expect(screen.getByText("Awaiting indexed cost basis")).toBeDefined()
    expect(screen.getByText(/Profit is not calculated/)).toBeDefined()
  })

  it("shows the disconnected state", () => {
    render(
      <PortfolioResults
        errorMessage={null}
        isConnected={false}
        isError={false}
        isPending={false}
        onConnect={vi.fn()}
        onRetry={vi.fn()}
        positions={[]}
      />,
    )

    expect(screen.getByText("Connect your wallet")).toBeDefined()
    expect(screen.getByRole("button", { name: "Open wallet" })).toBeDefined()
    expect(screen.queryByText("No active positions yet")).toBeNull()
  })
})
