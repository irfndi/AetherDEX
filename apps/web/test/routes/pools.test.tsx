import type { Pool } from "@aetherdex/shared"
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterContextProvider,
} from "@tanstack/react-router"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { ReactElement } from "react"
import { describe, expect, it, vi } from "vitest"
import { PoolsResults } from "../../src/routes/pools"

const pool: Pool = {
  poolId: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  token0Address: "0x1111111111111111111111111111111111111111",
  token1Address: "0x2222222222222222222222222222222222222222",
  fee: 3000,
  tickSpacing: 60,
  hookAddress: null,
  sqrtPriceX96: "79228162514264337593543950336",
  currentTick: 0,
  liquidity: "0",
  tvlUsd: 1_500_000,
  volume24hUsd: 250_000,
  fees24hUsd: 750,
  isActive: true,
  createdAt: 0,
  updatedAt: 0,
}

const defaults = {
  isPending: false,
  isError: false,
  pools: [] as readonly Pool[],
  tokens: {},
  onRetry: () => {},
}

const renderWithRouter = (ui: ReactElement) => {
  const rootRoute = createRootRoute()
  const poolDetailRoute = createRoute({ getParentRoute: () => rootRoute, path: "pools/$poolId" })
  const routeTree = rootRoute.addChildren([poolDetailRoute])
  const router = createRouter({ routeTree, history: createMemoryHistory() })
  return render(<RouterContextProvider router={router}>{ui}</RouterContextProvider>)
}

describe("PoolsResults", () => {
  it("shows a loading spinner while pending", () => {
    const { container } = render(<PoolsResults {...defaults} isPending />)
    expect(container.querySelector(".loading-spinner")).not.toBeNull()
    expect(screen.queryByText("No pools found.")).toBeNull()
    expect(screen.queryByText("Failed to load pools.")).toBeNull()
  })

  it("shows an honest error state instead of the empty state on failure", () => {
    render(<PoolsResults {...defaults} isError />)
    expect(screen.getByText("Failed to load pools.")).toBeDefined()
    expect(screen.queryByText("No pools found.")).toBeNull()
  })

  it("invokes onRetry when the retry button is clicked", async () => {
    const user = userEvent.setup()
    const onRetry = vi.fn()
    render(<PoolsResults {...defaults} isError onRetry={onRetry} />)
    await user.click(screen.getByRole("button", { name: "Retry" }))
    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it("shows the empty state only when data loaded with no pools", () => {
    render(<PoolsResults {...defaults} isError={false} />)
    expect(screen.getByText("No pools found.")).toBeDefined()
    expect(screen.queryByText("Failed to load pools.")).toBeNull()
  })

  it("renders pool cards when pools loaded successfully", () => {
    renderWithRouter(<PoolsResults {...defaults} pools={[pool]} />)
    expect(screen.getByText("0.30%")).toBeDefined()
    expect(screen.getByText("$1.50M")).toBeDefined()
  })
})
