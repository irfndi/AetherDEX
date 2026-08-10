import { act, renderHook, waitFor } from "@testing-library/react"
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

/** WebSocket that never auto-opens, so reconnect attempts can be exhausted. */
class SilentWebSocket {
  static instances: SilentWebSocket[] = []
  url: string
  onopen: ((ev: Event) => void) | null = null
  onmessage: ((ev: MessageEvent) => void) | null = null
  onclose: ((ev: CloseEvent) => void) | null = null
  onerror: ((ev: Event) => void) | null = null
  close = vi.fn()
  send = vi.fn()

  constructor(url: string) {
    this.url = url
    SilentWebSocket.instances.push(this)
  }
}

describe("useWebSocket reconnection lifecycle", () => {
  afterEach(() => {
    SilentWebSocket.instances = []
  })

  it("sets an error when reconnect attempts are exhausted after clean closes", async () => {
    vi.stubGlobal("WebSocket", SilentWebSocket)
    const { result } = renderHook(() =>
      useWebSocket({ url: "ws://localhost:8080/ws/test", reconnectAttempts: 2, reconnectInterval: 0 }),
    )
    await waitFor(() => {
      expect(SilentWebSocket.instances.length).toBe(1)
    })

    // close 1: budget 0 < 2 -> reconnect scheduled
    SilentWebSocket.instances[0]?.onclose?.(new Event("close") as CloseEvent)
    await waitFor(() => {
      expect(SilentWebSocket.instances.length).toBe(2)
    })

    // close 2: budget 1 < 2 -> reconnect scheduled
    SilentWebSocket.instances[1]?.onclose?.(new Event("close") as CloseEvent)
    await waitFor(() => {
      expect(SilentWebSocket.instances.length).toBe(3)
    })

    // close 3: budget exhausted -> error surfaces instead of a silent dash
    SilentWebSocket.instances[2]?.onclose?.(new Event("close") as CloseEvent)
    await waitFor(() => {
      expect(result.current.error).toBe("Connection lost; reconnection attempts exhausted")
    })
    expect(SilentWebSocket.instances.length).toBe(3)
  })

  it("does not reconnect a socket superseded by a url change", async () => {
    vi.stubGlobal("WebSocket", SilentWebSocket)
    const { rerender } = renderHook(
      ({ url }: { url: string }) => useWebSocket({ url, reconnectAttempts: 3, reconnectInterval: 0 }),
      { initialProps: { url: "ws://localhost:8080/ws/a" } },
    )
    await waitFor(() => {
      expect(SilentWebSocket.instances.length).toBe(1)
    })

    rerender({ url: "ws://localhost:8080/ws/b" })
    await waitFor(() => {
      expect(SilentWebSocket.instances.length).toBe(2)
    })
    expect(SilentWebSocket.instances[1]?.url).toBe("ws://localhost:8080/ws/b")

    // The old socket's close fires asynchronously, after the new effect mounted.
    SilentWebSocket.instances[0]?.onclose?.(new Event("close") as CloseEvent)
    // Give any (buggy) reconnect timer a chance to fire.
    await new Promise((resolve) => setTimeout(resolve, 50))

    // No third socket to the old URL was created.
    expect(SilentWebSocket.instances.length).toBe(2)
  })
})

describe("useWebSocket reconnect backoff", () => {
  afterEach(() => {
    MockWebSocket.instances = []
    SilentWebSocket.instances = []
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it("reconnects with capped exponential backoff after onclose", () => {
    vi.useFakeTimers()
    vi.stubGlobal("WebSocket", SilentWebSocket)
    const { result } = renderHook(() =>
      useWebSocket({ url: "ws://localhost:8080/ws/test", reconnectAttempts: 10, reconnectInterval: 1000 }),
    )

    act(() => {
      SilentWebSocket.instances[0]?.onclose?.(new Event("close") as CloseEvent)
    })
    expect(result.current.reconnectCount).toBe(1)

    // First backoff delay is interval * 1 — nothing before it fires.
    act(() => {
      vi.advanceTimersByTime(999)
    })
    expect(SilentWebSocket.instances.length).toBe(1)
    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(SilentWebSocket.instances.length).toBe(2)

    // Second close backs off by interval * 2.
    act(() => {
      SilentWebSocket.instances[1]?.onclose?.(new Event("close") as CloseEvent)
    })
    expect(result.current.reconnectCount).toBe(2)
    act(() => {
      vi.advanceTimersByTime(2000)
    })
    expect(SilentWebSocket.instances.length).toBe(3)
  })

  it("resets reconnectCount once a reconnected socket opens", () => {
    vi.useFakeTimers()
    vi.stubGlobal("WebSocket", MockWebSocket)
    const { result } = renderHook(() => useWebSocket({ url: "ws://localhost:8080/ws/test", reconnectInterval: 1000 }))

    act(() => {
      vi.advanceTimersByTime(0) // auto-open
    })
    act(() => {
      MockWebSocket.instances[0]?.onclose?.(new Event("close") as CloseEvent)
    })
    expect(result.current.reconnectCount).toBe(1)

    act(() => {
      vi.advanceTimersByTime(1001) // reconnect timer + the new socket's 0ms auto-open
    })
    expect(MockWebSocket.instances.length).toBe(2)
    expect(result.current.isConnected).toBe(true)
    expect(result.current.reconnectCount).toBe(0)
  })
})

describe("useWebSocket message parsing", () => {
  afterEach(() => {
    MockWebSocket.instances = []
    vi.unstubAllGlobals()
  })

  it("parses JSON messages into state and calls onMessage", async () => {
    vi.stubGlobal("WebSocket", MockWebSocket)
    const onMessage = vi.fn()
    const { result } = renderHook(() => useWebSocket({ url: "ws://localhost:8080/ws/test", onMessage }))
    await waitFor(() => {
      expect(MockWebSocket.instances.length).toBe(1)
    })

    act(() => {
      MockWebSocket.instances[0]?.onmessage?.(new MessageEvent("message", { data: '{"price":100}' }))
    })
    expect(result.current.data).toEqual({ price: 100 })
    expect(onMessage).toHaveBeenCalledWith({ price: 100 })
  })

  it("ignores non-JSON frames without clobbering the last good message", async () => {
    vi.stubGlobal("WebSocket", MockWebSocket)
    const { result } = renderHook(() => useWebSocket({ url: "ws://localhost:8080/ws/test" }))
    await waitFor(() => {
      expect(MockWebSocket.instances.length).toBe(1)
    })

    act(() => {
      MockWebSocket.instances[0]?.onmessage?.(new MessageEvent("message", { data: '{"price":100}' }))
    })
    act(() => {
      MockWebSocket.instances[0]?.onmessage?.(new MessageEvent("message", { data: "not json" }))
    })
    expect(result.current.data).toEqual({ price: 100 })
  })
})

describe("useWebSocket error handling", () => {
  afterEach(() => {
    MockWebSocket.instances = []
    vi.unstubAllGlobals()
  })

  it("surfaces socket errors via error state and the onError callback", async () => {
    vi.stubGlobal("WebSocket", MockWebSocket)
    const onError = vi.fn()
    const { result } = renderHook(() => useWebSocket({ url: "ws://localhost:8080/ws/test", onError }))
    await waitFor(() => {
      expect(MockWebSocket.instances.length).toBe(1)
    })

    act(() => {
      MockWebSocket.instances[0]?.onerror?.(new Event("error"))
    })
    expect(result.current.error).toBe("WebSocket connection error")
    expect(onError).toHaveBeenCalled()
  })
})
