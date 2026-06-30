/**
 * AetherDEX API — Cloudflare Workers entry point
 *
 * Stack: Hono (routing) + Effect TS (business logic)
 * Storage: D1 (hot), R2 (history), KV (cache), DO (stateful), Queues (jobs)
 */

import { Hono } from "hono"
import { cors } from "hono/cors"
import { logger } from "hono/logger"

type Bindings = {
  DB: D1Database
  CACHE: KVNamespace
  STORAGE: R2Bucket
  ORDER_BOOK: DurableObjectNamespace
  WEBSOCKET_HUB: DurableObjectNamespace
  PRICE_QUEUE: Queue<{ tokens: string[] }>
  SETTLE_QUEUE: Queue<{ txHash: string }>
  CHAIN_ID: string
  ENVIRONMENT: string
}

const app = new Hono<{ Bindings: Bindings }>()

// Middleware
app.use("*", logger())
app.use(
  "*",
  cors({
    origin: ["http://localhost:3000", "https://aetherdex.io"],
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization"],
    credentials: true,
  }),
)

// Health check
app.get("/health", (c) => c.json({ status: "ok", service: "aetherdex-api", timestamp: Date.now() }))

// Placeholder routes — will be implemented in T17/T18
app.get("/api/v1/ping", (c) => c.json({ pong: true }))

// 404
app.notFound((c) => c.json({ error: "Not found", path: c.req.path }, 404))

// Error handler
app.onError((err, c) => {
  console.error("API error:", err)
  return c.json({ error: err.message }, 500)
})

// ─── Durable Object classes — imported from dedicated modules ─────────────────

import { OrderBookDO, WebSocketHubDO } from "./durable-objects"

export { OrderBookDO, WebSocketHubDO }

// ─── Worker entry — combined Hono + DOs + Queue + Cron ────────────────────────

const worker = {
  fetch: app.fetch,

  async queue(batch: MessageBatch<{ tokens: string[] }>, _env: Bindings) {
    console.log(`Processing ${batch.messages.length} queue messages`)
    for (const message of batch.messages) {
      console.log("Queue message:", message.body)
      message.ack()
    }
  },

  async scheduled(event: ScheduledEvent, _env: Bindings, _ctx: ExecutionContext) {
    console.log("Cron trigger:", event.cron, "at", new Date(event.scheduledTime).toISOString())
    // Will be implemented in T19
  },
}

export default worker
