/**
 * AetherDEX API — Cloudflare Workers entry point
 *
 * Stack: Hono (routing) + Effect TS (business logic)
 * Storage: D1 (hot), R2 (history), KV (cache), DO (stateful), Queues (jobs)
 */

import { Hono } from "hono"
import { cors } from "hono/cors"
import { logger } from "hono/logger"
import { pools } from "./routes/pools"
import { tokens } from "./routes/tokens"
import { positions } from "./routes/positions"
import { swap } from "./routes/swap"
import { OrderBookDO, WebSocketHubDO } from "./durable-objects"
import { processQueueBatch, type QueueMessage } from "./workers/queue-handler"
import { handleScheduled } from "./workers/cron-handler"
import { auth } from "./auth/routes"

type Bindings = {
  DB: D1Database
  CACHE: KVNamespace
  STORAGE: R2Bucket
  ORDER_BOOK: DurableObjectNamespace
  WEBSOCKET_HUB: DurableObjectNamespace
  PRICE_QUEUE: Queue
  SETTLE_QUEUE: Queue
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

app.route("/api/v1/auth", auth)

app.route("/api/v1", swap)
app.route("/api/v1/pools", pools)
app.route("/api/v1/tokens", tokens)
app.route("/api/v1", positions)
app.get("/api/v1/ping", (c) => c.json({ pong: true }))

// 404
app.notFound((c) => c.json({ error: "Not found", path: c.req.path }, 404))

// Error handler
app.onError((err, c) => {
  console.error("API error:", err)
  return c.json({ error: err.message }, 500)
})

// ─── Durable Object classes — imported from dedicated modules ─────────────────

export { OrderBookDO, WebSocketHubDO }

// ─── Worker entry — combined Hono + DOs + Queue + Cron ────────────────────────

const worker = {
  fetch: app.fetch,

  async queue(batch: MessageBatch<QueueMessage>, env: Bindings) {
    await processQueueBatch(batch as MessageBatch<unknown>, {
      DB: env.DB,
      CACHE: env.CACHE,
      STORAGE: env.STORAGE,
      CHAIN_ID: env.CHAIN_ID,
    })
  },

  async scheduled(event: ScheduledEvent, env: Bindings, ctx: ExecutionContext) {
    await handleScheduled(event, env, ctx)
  },
}

export default worker
