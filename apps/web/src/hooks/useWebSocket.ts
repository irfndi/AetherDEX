import { useCallback, useEffect, useRef, useState } from "react"

export interface WebSocketOptions {
  url: string
  reconnectAttempts?: number
  reconnectInterval?: number
  onMessage?: (data: unknown) => void
  onOpen?: () => void
  onClose?: () => void
  onError?: (error: Event) => void
}

export interface WebSocketState<T = unknown> {
  data: T | null
  isConnected: boolean
  error: string | undefined
  reconnectCount: number
}

/**
 * WebSocket hook with exponential-backoff auto-reconnect.
 * Callbacks are read from refs so the effect only re-runs on `url` change.
 */
export function useWebSocket<T = unknown>(options: WebSocketOptions): WebSocketState<T> {
  const { url, reconnectAttempts = 10, reconnectInterval = 3000 } = options

  const [state, setState] = useState<WebSocketState<T>>({
    data: null,
    isConnected: false,
    error: undefined,
    reconnectCount: 0,
  })

  const wsRef = useRef<WebSocket | null>(null)
  const reconnectCountRef = useRef(0)
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const mountedRef = useRef(true)

  // Store callbacks in refs to avoid re-running the effect on every render
  const onMessageRef = useRef(options.onMessage)
  const onOpenRef = useRef(options.onOpen)
  const onCloseRef = useRef(options.onClose)
  const onErrorRef = useRef(options.onError)

  useEffect(() => {
    onMessageRef.current = options.onMessage
    onOpenRef.current = options.onOpen
    onCloseRef.current = options.onClose
    onErrorRef.current = options.onError
  }, [options.onMessage, options.onOpen, options.onClose, options.onError])

  const cleanup = useCallback(() => {
    if (reconnectTimerRef.current !== undefined) {
      clearTimeout(reconnectTimerRef.current)
    }
    if (wsRef.current) {
      wsRef.current.close()
      wsRef.current = null
    }
  }, [])

  useEffect(() => {
    mountedRef.current = true

    function connect() {
      if (!mountedRef.current) return

      try {
        const ws = new WebSocket(url)
        wsRef.current = ws

        ws.onopen = () => {
          if (!mountedRef.current) return
          reconnectCountRef.current = 0
          setState((prev) => ({
            ...prev,
            isConnected: true,
            error: undefined,
            reconnectCount: 0,
          }))
          onOpenRef.current?.()
        }

        ws.onmessage = (event) => {
          if (!mountedRef.current) return
          try {
            const parsed = JSON.parse(event.data) as T
            setState((prev) => ({ ...prev, data: parsed }))
            onMessageRef.current?.(parsed)
          } catch {
            // Non-JSON message, ignore
          }
        }

        ws.onclose = () => {
          if (!mountedRef.current) return
          setState((prev) => ({ ...prev, isConnected: false }))
          onCloseRef.current?.()

          // Auto-reconnect with capped exponential back-off
          if (reconnectCountRef.current < reconnectAttempts) {
            reconnectCountRef.current += 1
            setState((prev) => ({
              ...prev,
              reconnectCount: reconnectCountRef.current,
            }))
            const delay = reconnectInterval * Math.min(reconnectCountRef.current, 5)
            reconnectTimerRef.current = setTimeout(connect, delay)
          }
        }

        ws.onerror = (error) => {
          if (!mountedRef.current) return
          onErrorRef.current?.(error)
          setState((prev) => ({
            ...prev,
            error: "WebSocket connection error",
          }))
        }
      } catch (err) {
        if (!mountedRef.current) return
        setState((prev) => ({
          ...prev,
          error: `Failed to connect: ${String(err)}`,
        }))
      }
    }

    connect()

    return () => {
      mountedRef.current = false
      cleanup()
    }
  }, [url, reconnectAttempts, reconnectInterval, cleanup])

  return state
}
