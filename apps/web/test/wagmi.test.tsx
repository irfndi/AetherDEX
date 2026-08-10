import { createAppKit } from "@reown/appkit/react"
import { render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { queryClient } from "../src/query-client"
import { AppKitProvider } from "../src/wagmi"

vi.mock("@reown/appkit/react", () => ({
  createAppKit: vi.fn(),
}))

describe("app entry wiring", () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  // Order matters: the missing-env case must run before the stubbed-env case.
  // wagmi.tsx lazily reads the env on first render and caches the built config,
  // so a test that stubs the env first would pin the cache for later tests.
  it("renders a fallback instead of throwing when VITE_REOWN_PROJECT_ID is missing", () => {
    render(
      <AppKitProvider>
        <div>app content</div>
      </AppKitProvider>,
    )

    expect(screen.getByRole("alert")).toHaveTextContent("VITE_REOWN_PROJECT_ID")
    expect(screen.queryByText("app content")).not.toBeInTheDocument()
    expect(vi.mocked(createAppKit)).not.toHaveBeenCalled()
  })

  it("mounts the provider tree and initializes AppKit when the project id is set", () => {
    vi.stubEnv("VITE_REOWN_PROJECT_ID", "test-project-id")

    render(
      <AppKitProvider>
        <div>app content</div>
      </AppKitProvider>,
    )

    expect(screen.getByText("app content")).toBeInTheDocument()
    expect(vi.mocked(createAppKit)).toHaveBeenCalledWith(expect.objectContaining({ projectId: "test-project-id" }))
  })

  it("configures the query client defaults", () => {
    expect(queryClient.getDefaultOptions().queries?.staleTime).toBe(60_000)
    expect(queryClient.getDefaultOptions().queries?.refetchOnWindowFocus).toBe(false)
  })
})
