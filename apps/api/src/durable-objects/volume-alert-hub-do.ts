/**
 * AetherDEX Volume-Alert Hub Durable Object (Phase 3)
 *
 * Fan-out hub for volume-spike alerts. A single instance (named
 * "volume-alerts") serves every alert subscription: web clients connect to
 * `/ws/alerts` (all alerts) or `/ws/alerts/:poolId` (one pool). The cron
 * volume-alert tick POSTs alerts to `/alert`; each alert is fanned out as the
 * exact `{ type: "volume_alert", ... }` envelope, filtered to sockets that
 * either watch no pool (global) or watch the alert's pool.
 *
 * Uses the WebSocket Hibernation API: sockets stay connected across
 * hibernation and are enumerated via `ctx.getWebSockets()` at broadcast time,
 * with the per-socket pool filter carried in the socket attachment.
 */

interface Env {
  VOLUME_ALERT_HUB: DurableObjectNamespace
}

/** Persisted per-socket state (survives hibernation via the DO attachment). */
interface AlertFilter {
  readonly poolId?: string
}

/** The exact envelope cron produces and web consumers unwrap. */
interface VolumeAlertMessage {
  type: "volume_alert"
  chainId: number
  poolId: string
  volumeUsd: string
  thresholdUsd: string
  windowSeconds: number
  timestamp: number
}

interface IncomingMessage {
  type?: string
}

export class VolumeAlertHubDO implements DurableObject {
  private ctx: DurableObjectState
  // biome-ignore lint/correctness/noUnusedPrivateClassMembers: env holds the VOLUME_ALERT_HUB binding reserved for future self-referential fan-out
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

    // WebSocket upgrade — the optional `?poolId=` scopes the subscription.
    if (request.headers.get("Upgrade") === "websocket") {
      const poolId = url.searchParams.get("poolId") ?? undefined
      const webSocketPair = new WebSocketPair()
      const [client, server] = Object.values(webSocketPair) as [WebSocket, WebSocket]

      this.ctx.acceptWebSocket(server)
      server.serializeAttachment({ ...(poolId !== undefined ? { poolId } : {}) } satisfies AlertFilter)

      return new Response(null, { status: 101, webSocket: client })
    }

    // HTTP: broadcast a volume-spike alert (called by the cron volume-alert tick)
    if (request.method === "POST" && url.pathname === "/alert") {
      const alert = (await request.json()) as VolumeAlertMessage
      const subscribers = this.broadcast(alert)
      return new Response(JSON.stringify({ ok: true, subscribers }), {
        headers: { "Content-Type": "application/json" },
      })
    }

    // HTTP: subscriber stats
    if (request.method === "GET" && url.pathname === "/stats") {
      return new Response(JSON.stringify({ subscribers: this.ctx.getWebSockets().length }), {
        headers: { "Content-Type": "application/json" },
      })
    }

    return new Response("VolumeAlertHubDO: not found", { status: 404 })
  }

  async webSocketMessage(ws: WebSocket, rawMessage: string | ArrayBuffer): Promise<void> {
    try {
      const msg = JSON.parse(
        typeof rawMessage === "string" ? rawMessage : new TextDecoder().decode(rawMessage),
      ) as IncomingMessage
      // The auto-response handles the common ping; this path covers clients that
      // send a JSON ping the auto-response string match does not catch.
      if (msg.type === "ping") {
        ws.send(JSON.stringify({ type: "pong" }))
      }
    } catch {
      /* ignore malformed control messages */
    }
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string, _wasClean: boolean): Promise<void> {
    try {
      ws.close(code, reason)
    } catch {
      /* ignore — socket may already be closed */
    }
  }

  async webSocketError(ws: WebSocket, _error: unknown): Promise<void> {
    try {
      ws.close(1011, "WebSocket error")
    } catch {
      /* ignore */
    }
  }

  /**
   * Fan an alert out to every matching socket. Hibernation keeps accepted
   * sockets alive across eviction, so we enumerate `getWebSockets()` and read
   * each socket's persisted filter rather than holding an in-memory map. A
   * socket with no poolId (global listener) receives every alert; otherwise it
   * must match the alert's pool.
   */
  private broadcast(alert: VolumeAlertMessage): number {
    const data = JSON.stringify(alert)
    let delivered = 0
    for (const ws of this.ctx.getWebSockets()) {
      const filter = ws.deserializeAttachment() as AlertFilter | null
      if (filter?.poolId !== undefined && filter.poolId !== alert.poolId) continue
      try {
        ws.send(data)
        delivered += 1
      } catch (err) {
        console.error("VolumeAlertHubDO broadcast failed:", err)
      }
    }
    return delivered
  }
}
