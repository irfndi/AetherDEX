/**
 * AetherDEX API — Cloudflare Workers entry point
 *
 * Stack: Hono (routing) + Effect TS (business logic)
 * Storage: D1 (hot), R2 (history), KV (cache), DO (stateful), Queues (jobs)
 */

import { Hono } from "hono"
import { cors } from "hono/cors"
import { logger } from "hono/logger"
import { type AuthVariables, authMiddleware } from "./auth/middleware"
import { auth } from "./auth/routes"
import { OrderBookDO, SiweNonceDO, VolumeAlertHubDO, WebSocketHubDO } from "./durable-objects"
import { liquidity } from "./routes/liquidity"
import { pools } from "./routes/pools"
import { positions } from "./routes/positions"
import { priceGuard } from "./routes/price-guard"
import { swap } from "./routes/swap"
import { tokens } from "./routes/tokens"
import { v3Quote } from "./routes/v3-quote"
import { handleScheduled } from "./workers/cron-handler"
import { processQueueBatch, type QueueMessage } from "./workers/queue-handler"

type Bindings = {
  DB: D1Database
  CACHE: KVNamespace
  STORAGE: R2Bucket
  ORDER_BOOK: DurableObjectNamespace
  WEBSOCKET_HUB: DurableObjectNamespace
  SIWE_NONCE: DurableObjectNamespace
  VOLUME_ALERT_HUB: DurableObjectNamespace
  PRICE_QUEUE: Queue
  SETTLE_QUEUE: Queue
  KEEPER_QUEUE: Queue
  CHAIN_ID: string
  ENVIRONMENT: string
  // Cron/indexer chain config — optional; absent values keep ticks as no-ops.
  RPC_URL?: string
  V3_POSITION_MANAGER_ADDRESS?: string
  V3_POSITION_MANAGER_DEPLOYMENT_BLOCK?: string
  V3_INDEXED_POOL_ADDRESSES?: string
  V4_POOL_MANAGER_ADDRESS?: string
  INDEXER_ENABLED?: string
  INDEXER_BATCH_SIZE?: string
  // Phase 4 (#314) deployment config — contract addresses filled from the Deploy.s.sol summary.
  // AETHER_HOOK_ADDRESS + RPC_URL drive the keeper's on-chain TWAP reads in workers/queue-handler.ts
  // (TP/SL gating); empty/absent values keep the on-chain TWAP read disabled with a safe fallback.
  // TREASURY_ADDRESS / V3_EXECUTOR_ADDRESS are deployment records (fee accrues on-chain; the API
  // never signs from the treasury).
  AETHER_HOOK_ADDRESS?: string
  V3_EXECUTOR_ADDRESS?: string
  TREASURY_ADDRESS?: string
  // Phase 2/3 keeper relayer — secrets (KEEPER_PRIVATE_KEY, KEEPER_RPC_URL) via
  // `wrangler secret put`; non-secret knobs default to evaluation-only in
  // src/lib/keeper-signer.ts.
  TPSL_ADDRESS?: string
  AETHER_TPSL_ADDRESS?: string
  KEEPER_RPC_URL?: string
  KEEPER_MAX_GAS_PRICE_GWEI?: string
  KEEPER_MIN_BALANCE_ETH?: string
  KEEPER_ALLOW_PUBLIC_SUBMISSION?: string
  KEEPER_PRIVATE_KEY?: string
  // Phase-3 API safety knobs — optional; safe defaults live in src/lib/safety-config.ts.
  RATE_LIMIT_MAX?: string
  RATE_LIMIT_WINDOW_SECONDS?: string
  CIRCUIT_FAILURE_THRESHOLD?: string
  CIRCUIT_COOLDOWN_SECONDS?: string
  HIGH_VALUE_USD_THRESHOLD?: string
  MEV_PROTECTION_MODE?: string
  MEV_MAX_SLIPPAGE_BPS?: string
  PRIVATE_TX_RELAY_URL?: string
  // Phase-3 volume-spike alerts — optional; safe defaults live in src/services/volume-alerts.service.ts.
  // Telegram stays off until TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID secrets are set.
  VOLUME_ALERT_WINDOW_SECONDS?: string
  VOLUME_ALERT_THRESHOLD_USD?: string
  VOLUME_ALERT_COOLDOWN_SECONDS?: string
  TELEGRAM_BOT_TOKEN?: string
  TELEGRAM_CHAT_ID?: string
}

const app = new Hono<{ Bindings: Bindings; Variables: AuthVariables }>()

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
app.use("/api/v1/*", authMiddleware)

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

// ─── WebSocket upgrade routes (Phase-0 G1) ──────────────────────────────────
// Transport plumbing only: upgrades are routed to the Durable Objects, which
// own the WebSocket lifecycle (hibernation API, fan-out, snapshots).
//
//   /ws/prices/:tokenAddress  → WebSocketHubDO  (live price fan-out; a single
//                               hub instance serves all price subscriptions,
//                               matching PriceTicker/useWebSocket on the web)
//   /ws/orderbook/:poolId     → OrderBookDO     (one instance per pool id)

app.get("/ws/prices/:tokenAddress", async (c) => {
  const id = c.env.WEBSOCKET_HUB.idFromName("price-hub")
  return c.env.WEBSOCKET_HUB.get(id).fetch(c.req.raw)
})

app.get("/ws/orderbook/:poolId", async (c) => {
  const poolId = c.req.param("poolId")
  if (!/^0x[a-fA-F0-9]{64}$/.test(poolId)) {
    return c.json({ error: "Invalid poolId (must be 0x + 64 hex chars)" }, 400)
  }
  // Canonicalize BEFORE selecting the DO / forwarding the key: the same bytes32
  // pool spelled in different casings must map to ONE order book + snapshot key.
  const canonicalPoolId = poolId.toLowerCase()
  const url = new URL(c.req.url)
  url.searchParams.set("poolId", canonicalPoolId)
  const id = c.env.ORDER_BOOK.idFromName(canonicalPoolId)
  return c.env.ORDER_BOOK.get(id).fetch(
    new Request(url.toString(), { method: c.req.method, headers: c.req.raw.headers }),
  )
})

//   /ws/alerts               → VolumeAlertHubDO  (all volume-spike alerts)
//   /ws/alerts/:poolId       → VolumeAlertHubDO  (one pool; filter carried as ?poolId=)
// A single hub instance ("volume-alerts") fans cron-emitted alerts out to every
// subscriber; the per-pool route forwards a canonical lower-cased pool filter.

app.get("/ws/alerts", async (c) => {
  const id = c.env.VOLUME_ALERT_HUB.idFromName("volume-alerts")
  return c.env.VOLUME_ALERT_HUB.get(id).fetch(c.req.raw)
})

app.get("/ws/alerts/:poolId", async (c) => {
  const poolId = c.req.param("poolId")
  if (!/^0x[a-fA-F0-9]{64}$/.test(poolId)) {
    return c.json({ error: "Invalid poolId (must be 0x + 64 hex chars)" }, 400)
  }
  const canonicalPoolId = poolId.toLowerCase()
  const url = new URL(c.req.url)
  url.searchParams.set("poolId", canonicalPoolId)
  const id = c.env.VOLUME_ALERT_HUB.idFromName("volume-alerts")
  return c.env.VOLUME_ALERT_HUB.get(id).fetch(
    new Request(url.toString(), { method: c.req.method, headers: c.req.raw.headers }),
  )
})

app.route("/api/v1/auth", auth)

app.route("/api/v1", swap)
app.route("/api/v1/liquidity", liquidity)
app.route("/api/v1/pools", pools)
app.route("/api/v1/tokens", tokens)
app.route("/api/v1", positions)
app.route("/api/v1", priceGuard)
app.route("/api/v1", v3Quote)
app.get("/api/v1/ping", (c) => c.json({ pong: true }))

// 404
app.notFound((c) => c.json({ error: "Not found", path: c.req.path }, 404))

// Error handler — don't leak internal error details to clients
app.onError((err, c) => {
  console.error("API error:", err)
  return c.json({ error: "Internal server error" }, 500)
})

// ─── Durable Object classes — imported from dedicated modules ─────────────────

export { OrderBookDO, SiweNonceDO, VolumeAlertHubDO, WebSocketHubDO }

// ─── Worker entry — combined Hono + DOs + Queue + Cron ────────────────────────

const worker = {
  fetch: app.fetch,

  async queue(batch: MessageBatch<QueueMessage>, env: Bindings) {
    await processQueueBatch(batch as MessageBatch<unknown>, {
      DB: env.DB,
      CACHE: env.CACHE,
      STORAGE: env.STORAGE,
      WEBSOCKET_HUB: env.WEBSOCKET_HUB,
      CHAIN_ID: env.CHAIN_ID,
      RPC_URL: env.RPC_URL,
      AETHER_HOOK_ADDRESS: env.AETHER_HOOK_ADDRESS,
      TPSL_ADDRESS: env.TPSL_ADDRESS,
      AETHER_TPSL_ADDRESS: env.AETHER_TPSL_ADDRESS,
      KEEPER_PRIVATE_KEY: env.KEEPER_PRIVATE_KEY,
      KEEPER_RPC_URL: env.KEEPER_RPC_URL,
      KEEPER_MAX_GAS_PRICE_GWEI: env.KEEPER_MAX_GAS_PRICE_GWEI,
      KEEPER_MIN_BALANCE_ETH: env.KEEPER_MIN_BALANCE_ETH,
      KEEPER_ALLOW_PUBLIC_SUBMISSION: env.KEEPER_ALLOW_PUBLIC_SUBMISSION,
      PRIVATE_TX_RELAY_URL: env.PRIVATE_TX_RELAY_URL,
      INDEXER_ENABLED: env.INDEXER_ENABLED,
      INDEXER_BATCH_SIZE: env.INDEXER_BATCH_SIZE,
      V3_POSITION_MANAGER_ADDRESS: env.V3_POSITION_MANAGER_ADDRESS,
      V3_INDEXED_POOL_ADDRESSES: env.V3_INDEXED_POOL_ADDRESSES,
      V4_POOL_MANAGER_ADDRESS: env.V4_POOL_MANAGER_ADDRESS,
    })
  },

  async scheduled(event: ScheduledEvent, env: Bindings, ctx: ExecutionContext) {
    await handleScheduled(event, env, ctx)
  },
}

export default worker
