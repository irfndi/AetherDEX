import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { ThemeToggle } from "../../src/components/ThemeToggle"

const store = new Map<string, string>()

const mockStorage = {
  getItem: (key: string) => store.get(key) ?? null,
  setItem: (key: string, value: string) => {
    store.set(key, value)
  },
  removeItem: (key: string) => {
    store.delete(key)
  },
  clear: () => {
    store.clear()
  },
  get length() {
    return store.size
  },
  key: (index: number) => [...store.keys()][index] ?? null,
}

describe("ThemeToggle", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", mockStorage)
    mockStorage.clear()
    document.documentElement.setAttribute("data-theme", "aetherdex")
  })

  afterEach(() => {
    mockStorage.clear()
    vi.unstubAllGlobals()
  })

  it("renders toggle button", () => {
    render(<ThemeToggle />)
    expect(screen.getByRole("button", { name: /toggle theme/i })).toBeDefined()
  })

  it("toggles from aetherdex to light", async () => {
    const user = userEvent.setup()
    render(<ThemeToggle />)
    await user.click(screen.getByRole("button", { name: /toggle theme/i }))
    expect(document.documentElement.getAttribute("data-theme")).toBe("light")
  })

  it("toggles back to aetherdex", async () => {
    const user = userEvent.setup()
    mockStorage.setItem("aetherdex-theme", "light")
    render(<ThemeToggle />)
    await user.click(screen.getByRole("button", { name: /toggle theme/i }))
    expect(document.documentElement.getAttribute("data-theme")).toBe("aetherdex")
  })

  it("persists theme to localStorage", async () => {
    const user = userEvent.setup()
    render(<ThemeToggle />)
    await user.click(screen.getByRole("button", { name: /toggle theme/i }))
    expect(mockStorage.getItem("aetherdex-theme")).toBe("light")
  })

  it("reads initial theme from localStorage", () => {
    mockStorage.setItem("aetherdex-theme", "light")
    render(<ThemeToggle />)
    expect(document.documentElement.getAttribute("data-theme")).toBe("light")
  })

  it("shows sun icon when in dark mode (default)", () => {
    render(<ThemeToggle />)
    expect(screen.getByRole("img", { name: /switch to light theme/i })).toBeDefined()
  })

  it("shows moon icon after toggling to light mode", async () => {
    const user = userEvent.setup()
    render(<ThemeToggle />)
    await user.click(screen.getByRole("button", { name: /toggle theme/i }))
    expect(screen.getByRole("img", { name: /switch to dark theme/i })).toBeDefined()
  })
})
