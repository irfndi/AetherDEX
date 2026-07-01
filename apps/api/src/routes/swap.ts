/**
 * AetherDEX Swap HTTP endpoints
 * Quote generation, calldata building, swap recording
 */

import { Effect, Layer } from "effect"
import { Hono } from "hono"
import { type AuthVariables, requireAuth } from "../auth/middleware"
import { type SwapQuote, SwapService, SwapServiceDeps, SwapServiceLive } from "../services/swap.service"

const swap = new Hono<{ Bindings: Env; Variables: AuthVariables }>()

// ─── Address validation ──────────────────────────────────────────────────────

const ETH_ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/

// ─── GET /quote ──────────────────────────────────────────────────────────────

/**
 * GET /api/v1/quote?tokenIn=0x...&tokenOut=0x...&amountIn=1000000000000000000&slippage=0.5
 * Returns a swap quote with amountOut, minAmountOut, price impact
 */
swap.get("/quote", async (c) => {
  const tokenIn = c.req.query("tokenIn")
  const tokenOut = c.req.query("tokenOut")
  const amountIn = c.req.query("amountIn")
  const slippageTolerance = Number.parseFloat(c.req.query("slippage") ?? "0.5") / 100

  if (!tokenIn || !tokenOut || !amountIn) {
    return c.json({ error: "Missing required query params: tokenIn, tokenOut, amountIn" }, 400)
  }

  if (!ETH_ADDRESS_RE.test(tokenIn) || !ETH_ADDRESS_RE.test(tokenOut)) {
    return c.json({ error: "Invalid token address" }, 400)
  }

  try {
    if (!c.env.ROUTER_ADDRESS || !c.env.FACTORY_ADDRESS) {
      return c.json({ error: "Server misconfigured: missing ROUTER_ADDRESS or FACTORY_ADDRESS" }, 500)
    }
    const depsLayer = Layer.succeed(SwapServiceDeps, {
      db: c.env.DB as D1Database,
      routerAddress: c.env.ROUTER_ADDRESS,
      factoryAddress: c.env.FACTORY_ADDRESS,
    })
    const program = Effect.gen(function* () {
      const swapService = yield* SwapService
      return yield* swapService.getQuote({
        tokenIn,
        tokenOut,
        amountIn,
        slippageTolerance,
      })
    })
    const quote = await Effect.runPromise(Effect.provide(program, SwapServiceLive.pipe(Layer.provide(depsLayer))))
    return c.json(quote)
  } catch (err) {
    return c.json({ error: String(err) }, 500)
  }
})

// ─── POST /swap/build ────────────────────────────────────────────────────────

/**
 * POST /api/v1/swap/build
 * Build calldata for a swap transaction
 * Body: { quote: SwapQuote, recipient: "0x...", slippageTolerance?: number }
 * Returns: { to, data, value }
 */
swap.post("/build", async (c) => {
  const body = await c.req.json<{
    quote?: SwapQuote
    recipient?: string
  }>()

  if (!body.quote || !body.recipient) {
    return c.json({ error: "quote and recipient required" }, 400)
  }

  if (!ETH_ADDRESS_RE.test(body.recipient)) {
    return c.json({ error: "Invalid recipient address" }, 400)
  }

  const { quote, recipient } = body

  try {
    if (!c.env.ROUTER_ADDRESS || !c.env.FACTORY_ADDRESS) {
      return c.json({ error: "Server misconfigured: missing ROUTER_ADDRESS or FACTORY_ADDRESS" }, 500)
    }
    const depsLayer = Layer.succeed(SwapServiceDeps, {
      db: c.env.DB as D1Database,
      routerAddress: c.env.ROUTER_ADDRESS,
      factoryAddress: c.env.FACTORY_ADDRESS,
    })
    const program = Effect.gen(function* () {
      const swapService = yield* SwapService
      return yield* swapService.buildCalldata(quote, recipient)
    })
    const calldata = await Effect.runPromise(Effect.provide(program, SwapServiceLive.pipe(Layer.provide(depsLayer))))
    return c.json(calldata)
  } catch (err) {
    return c.json({ error: String(err) }, 500)
  }
})

// ─── POST /swap/record ───────────────────────────────────────────────────────

/**
 * POST /api/v1/swap/record
 * Record a confirmed swap transaction for indexing
 * Requires auth (only the user's own transactions)
 */
swap.post("/record", requireAuth, async (c) => {
  const session = c.get("session")
  if (!session) return c.json({ error: "Unauthorized" }, 401)

  const body = await c.req.json<{
    txHash?: string
    poolId?: string
    tokenIn?: string
    tokenOut?: string
    amountIn?: string
    amountOut?: string
    amountUsd?: number
    blockNumber?: number
    blockTimestamp?: number
  }>()

  if (!body.txHash || !body.blockNumber || !body.blockTimestamp) {
    return c.json({ error: "txHash, blockNumber, blockTimestamp required" }, 400)
  }

  const db = c.env.DB
  if (!db) {
    return c.json({ error: "Database not configured" }, 500)
  }

  try {
    await db
      .prepare(
        `INSERT INTO transactions
       (tx_hash, user_address, pool_id, tx_type, token_in, token_out, amount_in, amount_out, amount_usd, block_number, block_timestamp, status, created_at)
       VALUES (?, ?, ?, 'swap', ?, ?, ?, ?, ?, ?, ?, 'pending', ?)
       ON CONFLICT(tx_hash) DO NOTHING`,
      )
      .bind(
        body.txHash,
        session.userAddress,
        body.poolId ?? null,
        body.tokenIn ?? null,
        body.tokenOut ?? null,
        body.amountIn ?? null,
        body.amountOut ?? null,
        body.amountUsd ?? null,
        body.blockNumber,
        body.blockTimestamp,
        Date.now(),
      )
      .run()

    return c.json({ ok: true, txHash: body.txHash })
  } catch (err) {
    return c.json({ error: String(err) }, 500)
  }
})

export { swap }
