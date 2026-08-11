import { act, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { formatPercent, formatPrice, formatVolume, PriceTicker } from "../../src/components/PriceTicker"

class TickerSocket {
  static instances: TickerSocket[] = []
  onopen: ((ev: Event) => void) | null = null
  onmessage: ((ev: MessageEvent) => void) | null = null
  onclose: ((ev: CloseEvent) => void) | null = null
  onerror: ((ev: Event) => void) | null = null
  close = vi.fn()
  send = vi.fn()

  constructor() {
    TickerSocket.instances.push(this)
    setTimeout(() => this.onopen?.(new Event("open")), 0)
  }
}

function deliverFrame(instance: TickerSocket, frame: unknown) {
  instance.onmessage?.(new MessageEvent("message", { data: JSON.stringify(frame) }))
}

function firstSocket(): TickerSocket {
  const socket = TickerSocket.instances[0]
  if (!socket) throw new Error("expected a WebSocket instance")
  return socket
}

describe("formatPrice", () => {
  it("keeps significant digits for prices below 0.01", () => {
    // Regression: tiny nonzero prices must never render as "$0.00000000".
    expect(formatPrice(1e-9)).toBe("$1.000e-9")
    expect(formatPrice(0.0001234)).toBe("$0.0001234")
  })

  it("renders a placeholder for non-finite prices", () => {
    expect(formatPrice(Number.NaN)).toBe("—")
    expect(formatPrice(Number.POSITIVE_INFINITY)).toBe("—")
  })

  it("renders zero as $0.00", () => {
    expect(formatPrice(0)).toBe("$0.00")
  })

  it("formats common price ranges", () => {
    expect(formatPrice(1_500)).toBe("$1,500.00")
    expect(formatPrice(5)).toBe("$5.0000")
    expect(formatPrice(0.05)).toBe("$0.050000")
  })
})

describe("formatPercent", () => {
  it("formats positive and negative changes", () => {
    expect(formatPercent(1.234)).toBe("+1.23%")
    expect(formatPercent(-0.5)).toBe("-0.50%")
  })

  it("renders a placeholder for non-finite values", () => {
    expect(formatPercent(Number.NaN)).toBe("—")
  })
})

describe("formatVolume", () => {
  it("formats volume magnitudes", () => {
    expect(formatVolume(1_500_000)).toBe("$1.50M")
    expect(formatVolume(2_500)).toBe("$2.5K")
    expect(formatVolume(500)).toBe("$500")
  })

  it("renders a placeholder for non-finite or negative volumes", () => {
    expect(formatVolume(Number.NaN)).toBe("—")
    expect(formatVolume(-1)).toBe("—")
  })
})

describe("PriceTicker", () => {
  afterEach(() => {
    TickerSocket.instances = []
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it("ignores malformed price frames (NaN price, missing tokenAddress) instead of crashing", async () => {
    vi.stubGlobal("WebSocket", TickerSocket)
    render(<PriceTicker tokenAddress="0xabc" wsUrl="ws://localhost:8080/ws/prices/0xabc?chainId=1" />)

    await waitFor(() => {
      expect(TickerSocket.instances.length).toBe(1)
    })
    const socket = firstSocket()

    // NaN passes `typeof === "number"` but must not render "$NaN".
    await act(async () => {
      deliverFrame(socket, { type: "tick", data: { tokenAddress: "0xabc", price: Number.NaN } })
    })
    expect(screen.getByText("—")).toBeTruthy()

    // A frame with a price but no tokenAddress must not throw inside the effect.
    await act(async () => {
      deliverFrame(socket, { type: "ping", data: { price: 1 } })
    })
    expect(screen.getByText("—")).toBeTruthy()
  })

  it("clears the previous token's price when tokenAddress changes", async () => {
    vi.stubGlobal("WebSocket", TickerSocket)
    const wsUrl = "ws://localhost:8080/ws/prices/0xabc?chainId=1"
    const { rerender } = render(<PriceTicker tokenAddress="0xabc" wsUrl={wsUrl} />)

    await waitFor(() => {
      expect(TickerSocket.instances.length).toBe(1)
    })
    const socket = firstSocket()

    await act(async () => {
      deliverFrame(socket, { type: "tick", data: { tokenAddress: "0xabc", price: 5 } })
    })
    expect(screen.getByText("$5.0000")).toBeTruthy()

    // No envelope for the new token yet: remounting via key resets all state.
    rerender(<PriceTicker key="0xdef" tokenAddress="0xdef" wsUrl={wsUrl} />)
    expect(screen.getByText("—")).toBeTruthy()
  })

  it("renders the placeholder when the envelope is for another token", async () => {
    vi.stubGlobal("WebSocket", TickerSocket)
    render(<PriceTicker tokenAddress="0xabc" wsUrl="ws://localhost:8080/ws/prices/0xabc?chainId=1" />)

    await waitFor(() => {
      expect(TickerSocket.instances.length).toBe(1)
    })
    const socket = firstSocket()

    await act(async () => {
      deliverFrame(socket, { type: "tick", data: { tokenAddress: "0xdef", price: 5 } })
    })
    expect(screen.getByText("—")).toBeTruthy()
  })

  it("does not crash when change24h/volume24h arrive as null", async () => {
    vi.stubGlobal("WebSocket", TickerSocket)
    render(<PriceTicker tokenAddress="0xabc" wsUrl="ws://localhost:8080/ws/prices/0xabc?chainId=1" showVolume />)

    await waitFor(() => {
      expect(TickerSocket.instances.length).toBe(1)
    })
    const socket = firstSocket()

    await act(async () => {
      deliverFrame(socket, {
        type: "tick",
        data: { tokenAddress: "0xabc", price: 2, change24h: null, volume24h: null },
      })
    })
    expect(screen.getByText("$2.0000")).toBeTruthy()
  })

  it("renders the connection-failed state when the socket errors before any data", async () => {
    vi.stubGlobal("WebSocket", TickerSocket)
    render(<PriceTicker tokenAddress="0xabc" wsUrl="ws://localhost:8080/ws/prices/0xabc?chainId=1" />)

    await waitFor(() => {
      expect(TickerSocket.instances.length).toBe(1)
    })
    const socket = firstSocket()

    await act(async () => {
      socket.onerror?.(new Event("error"))
    })
    expect(screen.getByText("Connection failed")).toBeTruthy()
  })
})
