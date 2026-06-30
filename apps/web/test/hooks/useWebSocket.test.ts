import { renderHook, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { useWebSocket } from "../../src/hooks/useWebSocket"

class MockWebSocket {
  static instances: MockWebSocket[] = []
  url: string
  onopen: ((ev: Event) => void) | null = null
  onmessage: ((ev: MessageEvent) => void) | null = null
  onclose: ((ev: CloseEvent) => void) | null = null
  onerror: ((ev: Event) => void) | null = null
  close = vi.fn()
  send = vi.fn()

  constructor(url: string) {
    this.url = url
    MockWebSocket.instances.push(this)
    setTimeout(() => this.onopen?.(new Event("open")), 0)
  }
}

describe("useWebSocket", () => {
  afterEach(() => {
    MockWebSocket.instances = []
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it("initializes with disconnected state", () => {
    vi.stubGlobal("WebSocket", MockWebSocket)
    const { result } = renderHook(() => useWebSocket({ url: "ws://localhost:8080/ws/test" }))
    expect(result.current.data).toBeNull()
    expect(result.current.reconnectCount).toBe(0)
  })

  it("connects and sets isConnected on open", async () => {
    vi.stubGlobal("WebSocket", MockWebSocket)
    const { result } = renderHook(() => useWebSocket({ url: "ws://localhost:8080/ws/test" }))
    await waitFor(() => {
      expect(result.current.isConnected).toBe(true)
    })
    expect(MockWebSocket.instances.length).toBe(1)
  })

  it("calls onOpen callback", async () => {
    vi.stubGlobal("WebSocket", MockWebSocket)
    const onOpen = vi.fn()
    renderHook(() => useWebSocket({ url: "ws://localhost:8080/ws/test", onOpen }))
    await waitFor(() => {
      expect(onOpen).toHaveBeenCalledOnce()
    })
  })

  it("handles WebSocket constructor error", async () => {
    vi.stubGlobal(
      "WebSocket",
      class {
        constructor() {
          throw new Error("Connection failed")
        }
      },
    )
    const { result } = renderHook(() => useWebSocket({ url: "ws://localhost:8080/ws/test" }))
    await waitFor(() => {
      expect(result.current.error).toContain("Failed to connect")
    })
  })

  it("cleans up on unmount", async () => {
    vi.stubGlobal("WebSocket", MockWebSocket)
    const { unmount } = renderHook(() => useWebSocket({ url: "ws://localhost:8080/ws/test" }))
    await waitFor(() => {
      expect(MockWebSocket.instances.length).toBe(1)
    })
    unmount()
    await waitFor(() => {
      expect(MockWebSocket.instances[0]?.close).toHaveBeenCalled()
    })
  })

  it("uses custom reconnect settings", async () => {
    vi.stubGlobal("WebSocket", MockWebSocket)
    renderHook(() =>
      useWebSocket({
        url: "ws://localhost:8080/ws/test",
        reconnectAttempts: 5,
        reconnectInterval: 1000,
      }),
    )
    await waitFor(() => {
      expect(MockWebSocket.instances.length).toBe(1)
    })
  })
})
