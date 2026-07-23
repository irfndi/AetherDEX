/**
 * AetherDEX WebSocket Hub Durable Object
 *
 * Fan-out hub for live per-token price updates. A single instance serves all
 * price subscriptions (web `PriceTicker` connects to `/ws/prices/:tokenAddress`);
 * producers (the price-refresh queue pipeline) POST refreshed prices, which are
 * fanned out as `{ type: "price_update", data: { tokenAddress, price, updatedAt } }`
 * — the exact envelope the web consumer unwraps.
 */

interface Env {
  WEBSOCKET_HUB: DurableObjectNamespace
  CACHE: KVNamespace
}

interface Subscriber {
  webSocket: WebSocket
  watchedKeys: Set<string>
  connectedAt: number
}

/** Persisted per-socket state (survives hibernation via the DO attachment). */
interface WatchAttachment {
  readonly watchedKeys: readonly string[]
}

interface TokenPriceUpdate {
  tokenAddress: string
  price: number
  updatedAt: number
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
  // biome-ignore lint/correctness/noUnusedPrivateClassMembers: env holds the CACHE KV binding reserved for Phase-0 WebSocket live-data reads
  private env: Env
  private subscribers: Map<WebSocket, Subscriber> = new Map()
  private knownTokens: Set<string> = new Set()

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

      this.ctx.acceptWebSocket(server)
      server.serializeAttachment({ watchedKeys: [] } satisfies WatchAttachment)
      this.subscribers.set(server, {
        webSocket: server,
        watchedKeys: new Set(),
        connectedAt: Date.now(),
      })

      return new Response(null, { status: 101, webSocket: client })
    }

    // HTTP: broadcast a refreshed token price (called by the price-refresh queue pipeline)
    if (request.method === "POST" && url.pathname === "/price") {
      const update = (await request.json()) as TokenPriceUpdate
      this.knownTokens.add(update.tokenAddress)
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
          knownTokens: this.knownTokens.size,
          tokenAddresses: Array.from(this.knownTokens),
        }),
        { headers: { "Content-Type": "application/json" } },
      )
    }

    return new Response("WebSocketHubDO: not found", { status: 404 })
  }

  async webSocketMessage(ws: WebSocket, rawMessage: string | ArrayBuffer): Promise<void> {
    try {
      this.hydrateSubscribers()
      const msg = JSON.parse(
        typeof rawMessage === "string" ? rawMessage : new TextDecoder().decode(rawMessage),
      ) as SubscribeMessage
      const subscriber = this.subscribers.get(ws)
      if (!subscriber) return

      switch (msg.type) {
        case "ping":
          this.sendToSocket(ws, { type: "pong" })
          break
        case "subscribe":
          if (msg.poolId) {
            subscriber.watchedKeys.add(msg.poolId)
            this.persistWatched(ws, subscriber)
            this.sendToSocket(ws, { type: "subscribed", data: { poolId: msg.poolId } })
          }
          break
        case "unsubscribe":
          if (msg.poolId) {
            subscriber.watchedKeys.delete(msg.poolId)
            this.persistWatched(ws, subscriber)
            this.sendToSocket(ws, { type: "unsubscribed", data: { poolId: msg.poolId } })
          }
          break
        case "list_pools":
          this.sendToSocket(ws, { type: "pool_list", pools: Array.from(this.knownTokens) })
          break
      }
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
    console.error("WebSocketHubDO error:", error)
    this.subscribers.delete(ws)
    try {
      ws.close(1011, "WebSocket error")
    } catch {
      /* ignore */
    }
  }

  /**
   * Rebuild the in-memory subscriber map after hibernation. The Hibernation API keeps
   * accepted sockets connected across hibernation, but this DO's in-memory state (the
   * subscribers map) does not survive it — a woken instance (e.g. a price-refresh POST
   * five minutes later) would otherwise broadcast to nobody. `getWebSockets()` returns
   * the still-connected sockets and the attachment carries their watched keys.
   */
  private hydrateSubscribers(): void {
    for (const ws of this.ctx.getWebSockets()) {
      if (this.subscribers.has(ws)) continue
      const attachment = ws.deserializeAttachment() as WatchAttachment | null
      this.subscribers.set(ws, {
        webSocket: ws,
        watchedKeys: new Set(attachment?.watchedKeys ?? []),
        connectedAt: Date.now(),
      })
    }
  }

  private persistWatched(ws: WebSocket, subscriber: Subscriber): void {
    try {
      ws.serializeAttachment({ watchedKeys: [...subscriber.watchedKeys] } satisfies WatchAttachment)
    } catch (err) {
      console.error("Failed to persist watched keys:", err)
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

  private broadcastPrice(update: TokenPriceUpdate): void {
    this.hydrateSubscribers()
    const message: HubMessage = { type: "price_update", data: update }
    const data = JSON.stringify(message)
    for (const [ws, subscriber] of this.subscribers) {
      // Fan out to subscribers watching this token, or to global listeners
      // (no watched keys — e.g. web PriceTicker, which filters client-side).
      if (subscriber.watchedKeys.has(update.tokenAddress) || subscriber.watchedKeys.size === 0) {
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
