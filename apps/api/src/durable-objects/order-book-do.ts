/**
 * AetherDEX OrderBook Durable Object
 *
 * Per-pool order book state with WebSocket broadcast.
 * One DO instance per pool (key = poolId).
 * Uses WebSocket Hibernation API for cost efficiency (no CPU charges while idle).
 */

interface Env {
  ORDER_BOOK: DurableObjectNamespace
  CACHE: KVNamespace
}

interface Subscriber {
  webSocket: WebSocket
  subscribedAt: number
}

interface OrderBookSnapshot {
  poolId: string
  /** Current sqrt price X96 */
  sqrtPriceX96: string
  /** Current tick */
  tick: number
  /** Total active liquidity */
  liquidity: string
  /** ISO timestamp */
  updatedAt: string
}

interface SubscriptionMessage {
  type: "subscribe" | "unsubscribe" | "ping"
  topic?: string
}

interface BroadcastMessage {
  type: "orderbook_update" | "pong" | "subscribed" | "unsubscribed" | "error"
  data?: unknown
  message?: string
}

export class OrderBookDO implements DurableObject {
  private ctx: DurableObjectState
  private env: Env
  private subscribers: Map<WebSocket, Subscriber> = new Map()

  constructor(ctx: DurableObjectState, env: Env) {
    this.ctx = ctx
    this.env = env
    // Auto-respond to ping messages without waking the DO from hibernation
    ctx.setWebSocketAutoResponse(
      new WebSocketRequestResponsePair(JSON.stringify({ type: "ping" }), JSON.stringify({ type: "pong" })),
    )
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)

    // WebSocket upgrade
    if (request.headers.get("Upgrade") === "websocket") {
      const webSocketPair = new WebSocketPair()
      const [client, server] = Object.values(webSocketPair) as [WebSocket, WebSocket]

      this.ctx.acceptWebSocket(server, [url.searchParams.get("poolId") ?? "unknown"])
      this.subscribers.set(server, {
        webSocket: server,
        subscribedAt: Date.now(),
      })

      // Send initial snapshot
      const snapshot = await this.loadSnapshot(url.searchParams.get("poolId") ?? "")
      this.sendToSocket(server, {
        type: "orderbook_update",
        data: snapshot,
      })

      return new Response(null, { status: 101, webSocket: client })
    }

    // HTTP: trigger update (used by queue consumers)
    if (request.method === "POST" && url.pathname === "/update") {
      const snapshot = (await request.json()) as OrderBookSnapshot
      await this.persistSnapshot(snapshot)
      this.broadcast({ type: "orderbook_update", data: snapshot })
      return new Response(JSON.stringify({ ok: true, subscribers: this.subscribers.size }), {
        headers: { "Content-Type": "application/json" },
      })
    }

    // HTTP: subscriber stats
    if (request.method === "GET" && url.pathname === "/stats") {
      return new Response(
        JSON.stringify({ subscribers: this.subscribers.size, poolId: url.searchParams.get("poolId") }),
        { headers: { "Content-Type": "application/json" } },
      )
    }

    return new Response("OrderBookDO: not found", { status: 404 })
  }

  async webSocketMessage(ws: WebSocket, rawMessage: string | ArrayBuffer): Promise<void> {
    try {
      const msg = JSON.parse(
        typeof rawMessage === "string" ? rawMessage : new TextDecoder().decode(rawMessage),
      ) as SubscriptionMessage
      if (msg.type === "ping") {
        this.sendToSocket(ws, { type: "pong" })
      }
      // No-op for subscribe/unsubscribe (we auto-subscribe on connect)
    } catch (err) {
      this.sendToSocket(ws, { type: "error", message: `Invalid message: ${err}` })
    }
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string, _wasClean: boolean): Promise<void> {
    this.subscribers.delete(ws)
    try {
      ws.close(code, reason)
    } catch {
      /* ignore — socket may already be closed */
    }
  }

  async webSocketError(ws: WebSocket, error: unknown): Promise<void> {
    console.error("OrderBookDO WebSocket error:", error)
    this.subscribers.delete(ws)
    try {
      ws.close(1011, "WebSocket error")
    } catch {
      /* ignore */
    }
  }

  private sendToSocket(ws: WebSocket, msg: BroadcastMessage): void {
    try {
      ws.send(JSON.stringify(msg))
    } catch (err) {
      console.error("Failed to send to socket:", err)
      this.subscribers.delete(ws)
    }
  }

  private broadcast(msg: BroadcastMessage): void {
    const data = JSON.stringify(msg)
    for (const [ws] of this.subscribers) {
      try {
        ws.send(data)
      } catch (err) {
        console.error("Broadcast send failed:", err)
        this.subscribers.delete(ws)
      }
    }
  }

  private async persistSnapshot(snapshot: OrderBookSnapshot): Promise<void> {
    await this.ctx.storage.put(`snapshot:${snapshot.poolId}`, snapshot)
  }

  private async loadSnapshot(poolId: string): Promise<OrderBookSnapshot> {
    const snapshot = await this.ctx.storage.get<OrderBookSnapshot>(`snapshot:${poolId}`)
    if (snapshot) return snapshot
    // Default snapshot if no data yet
    return {
      poolId,
      sqrtPriceX96: "0",
      tick: 0,
      liquidity: "0",
      updatedAt: new Date().toISOString(),
    }
  }
}
