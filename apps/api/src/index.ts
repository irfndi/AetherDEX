/**
 * AetherDEX API — Cloudflare Workers entry point
 *
 * Stack: Hono (routing) + Effect TS (business logic)
 * Storage: D1 (hot), R2 (history), KV (cache), DO (stateful), Queues (jobs)
 */

import { Hono } from "hono"
import { cors } from "hono/cors"
import { logger } from "hono/logger"
import { auth } from "./auth/routes"
import { OrderBookDO, WebSocketHubDO } from "./durable-objects"
import { pools } from "./routes/pools"
import { positions } from "./routes/positions"
import { swap } from "./routes/swap"
import { tokens } from "./routes/tokens"
import { handleScheduled } from "./workers/cron-handler"
import { processQueueBatch, type QueueMessage } from "./workers/queue-handler"

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

// Structured error logging for observability
app.use("*", async (c, next) => {
  const start = Date.now()
  const path = c.req.path
  const method = c.req.method

  await next()

  const status = c.res.status
  const duration = Date.now() - start

  console.log(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      level: status >= 500 ? "error" : status >= 400 ? "warn" : "info",
      method,
      path,
      status,
      durationMs: duration,
      env: c.env.ENVIRONMENT,
    }),
  )
})

// Health check with deep dependency probes
app.get("/health", async (c) => {
  const checks = {
    status: "ok" as const,
    timestamp: Date.now(),
    environment: c.env.ENVIRONMENT,
    chainId: c.env.CHAIN_ID,
    checks: {
      d1: await checkD1(c.env.DB),
      kv: await checkKV(c.env.CACHE),
      r2: await checkR2(c.env.STORAGE),
    },
  }

  const allHealthy = Object.values(checks.checks).every((c) => c.healthy)
  return c.json(checks, allHealthy ? 200 : 503)
})

async function checkD1(db: D1Database): Promise<{ healthy: boolean; latencyMs: number }> {
  const start = Date.now()
  try {
    await db.prepare("SELECT 1").first()
    return { healthy: true, latencyMs: Date.now() - start }
  } catch {
    return { healthy: false, latencyMs: Date.now() - start }
  }
}

async function checkKV(kv: KVNamespace): Promise<{ healthy: boolean; latencyMs: number }> {
  const start = Date.now()
  try {
    await kv.get("health-check-probe")
    return { healthy: true, latencyMs: Date.now() - start }
  } catch {
    return { healthy: false, latencyMs: Date.now() - start }
  }
}

async function checkR2(r2: R2Bucket): Promise<{ healthy: boolean; latencyMs: number }> {
  const start = Date.now()
  try {
    await r2.list({ limit: 1 })
    return { healthy: true, latencyMs: Date.now() - start }
  } catch {
    return { healthy: false, latencyMs: Date.now() - start }
  }
}

app.route("/api/v1/auth", auth)

app.route("/api/v1", swap)
app.route("/api/v1/pools", pools)
app.route("/api/v1/tokens", tokens)
app.route("/api/v1", positions)
app.get("/api/v1/ping", (c) => c.json({ pong: true }))

// 404
app.notFound((c) => c.json({ error: "Not found", path: c.req.path }, 404))

// Error handler — don't leak internal error details to clients
app.onError((err, c) => {
  console.error("API error:", err)
  return c.json({ error: "Internal server error" }, 500)
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
