/**
 * AetherDEX WebSocket Hub Durable Object
 *
 * Fan-out hub for live price updates across multiple pools.
 * Single instance handles all price subscriptions, distributes to relevant pool DOs.
 */

interface Env {
  WEBSOCKET_HUB: DurableObjectNamespace
  CACHE: KVNamespace
}

interface Subscriber {
  webSocket: WebSocket
  watchedPools: Set<string>
  connectedAt: number
}

interface PriceUpdate {
  poolId: string
  token0Address: string
  token1Address: string
  price0Usd: number
  price1Usd: number
  tvlUsd: number
  volume24hUsd: number
  blockNumber: number
  timestamp: number
}

interface SubscribeMessage {
  type: "subscribe" | "unsubscribe" | "list_pools" | "ping"
  poolId?: string
}

interface HubMessage {
  type: "price_update" | "subscribed" | "unsubscribed" | "pong" | "pool_list" | "error"
  data?: unknown
  message?: string
  pools?: string[]
}

export class WebSocketHubDO implements DurableObject {
  private ctx: DurableObjectState
  private env: Env
  private subscribers: Map<WebSocket, Subscriber> = new Map()
  private knownPools: Set<string> = new Set()

  constructor(ctx: DurableObjectState, env: Env) {
    this.ctx = ctx
    this.env = env
    // Auto-respond to ping messages without waking the DO from hibernation
    ctx.setWebSocketAutoResponse(
      new WebSocketRequestResponsePair(
        JSON.stringify({ type: "ping" }),
        JSON.stringify({ type: "pong" }),
      ),
    )
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)

    // WebSocket upgrade
    if (request.headers.get("Upgrade") === "websocket") {
      const webSocketPair = new WebSocketPair()
      const [client, server] = Object.values(webSocketPair) as [WebSocket, WebSocket]

      this.ctx.acceptWebSocket(server)
      this.subscribers.set(server, {
        webSocket: server,
        watchedPools: new Set(),
        connectedAt: Date.now(),
      })

      return new Response(null, { status: 101, webSocket: client })
    }

    // HTTP: broadcast price update (used by queue consumers / cron)
    if (request.method === "POST" && url.pathname === "/price") {
      const update = (await request.json()) as PriceUpdate
      this.knownPools.add(update.poolId)
      this.broadcastPrice(update)
      return new Response(JSON.stringify({ ok: true, subscribers: this.subscribers.size }), {
        headers: { "Content-Type": "application/json" },
      })
    }

    // HTTP: subscriber stats
    if (request.method === "GET" && url.pathname === "/stats") {
      return new Response(
        JSON.stringify({
          subscribers: this.subscribers.size,
          knownPools: this.knownPools.size,
          poolIds: Array.from(this.knownPools),
        }),
        { headers: { "Content-Type": "application/json" } },
      )
    }

    return new Response("WebSocketHubDO: not found", { status: 404 })
  }

  async webSocketMessage(ws: WebSocket, rawMessage: string | ArrayBuffer): Promise<void> {
    try {
      const msg = JSON.parse(typeof rawMessage === "string" ? rawMessage : new TextDecoder().decode(rawMessage)) as SubscribeMessage
      const subscriber = this.subscribers.get(ws)
      if (!subscriber) return

      switch (msg.type) {
        case "ping":
          this.sendToSocket(ws, { type: "pong" })
          break
        case "subscribe":
          if (msg.poolId) {
            subscriber.watchedPools.add(msg.poolId)
            this.sendToSocket(ws, { type: "subscribed", data: { poolId: msg.poolId } })
          }
          break
        case "unsubscribe":
          if (msg.poolId) {
            subscriber.watchedPools.delete(msg.poolId)
            this.sendToSocket(ws, { type: "unsubscribed", data: { poolId: msg.poolId } })
          }
          break
        case "list_pools":
          this.sendToSocket(ws, { type: "pool_list", pools: Array.from(this.knownPools) })
          break
      }
    } catch (err) {
      this.sendToSocket(ws, { type: "error", message: `Invalid message: ${err}` })
    }
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string, wasClean: boolean): Promise<void> {
    this.subscribers.delete(ws)
    try {
      ws.close(code, reason)
    } catch {
      /* ignore — socket may already be closed */
    }
  }

  async webSocketError(ws: WebSocket, error: unknown): Promise<void> {
    console.error("WebSocketHubDO error:", error)
    this.subscribers.delete(ws)
    try {
      ws.close(1011, "WebSocket error")
    } catch {
      /* ignore */
    }
  }

  private sendToSocket(ws: WebSocket, msg: HubMessage): void {
    try {
      ws.send(JSON.stringify(msg))
    } catch (err) {
      console.error("Failed to send to socket:", err)
      this.subscribers.delete(ws)
    }
  }

  private broadcastPrice(update: PriceUpdate): void {
    const message: HubMessage = { type: "price_update", data: update }
    const data = JSON.stringify(message)
    for (const [ws, subscriber] of this.subscribers) {
      // Send to subscribers watching this pool, or all if they watch nothing (global listeners)
      if (subscriber.watchedPools.has(update.poolId) || subscriber.watchedPools.size === 0) {
        try {
          ws.send(data)
        } catch (err) {
          console.error("Broadcast price failed:", err)
          this.subscribers.delete(ws)
        }
      }
    }
  }
}
