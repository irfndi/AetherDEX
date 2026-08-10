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

/** Persisted per-socket state (survives hibernation via the DO attachment). */
interface PoolFilter {
  readonly poolId?: string
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
  // biome-ignore lint/correctness/noUnusedPrivateClassMembers: env holds the CACHE KV binding reserved for Phase-0 WebSocket live-data reads
  private env: Env

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
      const poolId = url.searchParams.get("poolId") ?? undefined
      const webSocketPair = new WebSocketPair()
      const [client, server] = Object.values(webSocketPair) as [WebSocket, WebSocket]

      this.ctx.acceptWebSocket(server, [poolId ?? "unknown"])
      // Persist the pool filter in the socket attachment — in-memory state does
      // not survive hibernation, but attachments and getWebSockets() do.
      server.serializeAttachment({ ...(poolId !== undefined ? { poolId } : {}) } satisfies PoolFilter)

      // Send initial snapshot
      const snapshot = await this.loadSnapshot(poolId ?? "")
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
      const subscribers = this.broadcast(snapshot)
      return new Response(JSON.stringify({ ok: true, subscribers }), {
        headers: { "Content-Type": "application/json" },
      })
    }

    // HTTP: subscriber stats
    if (request.method === "GET" && url.pathname === "/stats") {
      return new Response(
        JSON.stringify({ subscribers: this.ctx.getWebSockets().length, poolId: url.searchParams.get("poolId") }),
        { headers: { "Content-Type": "application/json" } },
      )
    }

    return new Response("OrderBookDO: not found", { status: 404 })
  }

  async webSocketMessage(ws: WebSocket, rawMessage: string | ArrayBuffer): Promise<void> {
    let msg: SubscriptionMessage
    try {
      msg = JSON.parse(
        typeof rawMessage === "string" ? rawMessage : new TextDecoder().decode(rawMessage),
      ) as SubscriptionMessage
    } catch (err) {
      console.error("OrderBookDO invalid message:", err)
      this.sendToSocket(ws, { type: "error", message: "Invalid message" })
      return
    }
    if (msg.type === "ping") {
      this.sendToSocket(ws, { type: "pong" })
    }
    // No-op for subscribe/unsubscribe (we auto-subscribe on connect)
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string, _wasClean: boolean): Promise<void> {
    try {
      ws.close(code, reason)
    } catch {
      /* ignore — socket may already be closed */
    }
  }

  async webSocketError(ws: WebSocket, error: unknown): Promise<void> {
    console.error("OrderBookDO WebSocket error:", error)
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
    }
  }

  /**
   * Fan a snapshot out to every connected socket. Hibernation keeps accepted
   * sockets alive across eviction, so we enumerate `getWebSockets()` and read
   * each socket's persisted pool filter rather than holding an in-memory map
   * (which a fresh instance after wake would not have). A socket without a
   * pool filter receives every update.
   */
  private broadcast(snapshot: OrderBookSnapshot): number {
    const data = JSON.stringify({ type: "orderbook_update", data: snapshot } satisfies BroadcastMessage)
    let delivered = 0
    for (const ws of this.ctx.getWebSockets()) {
      const filter = ws.deserializeAttachment() as PoolFilter | null
      if (filter?.poolId !== undefined && filter.poolId !== snapshot.poolId) continue
      try {
        ws.send(data)
        delivered += 1
      } catch (err) {
        console.error("Broadcast send failed:", err)
      }
    }
    return delivered
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
