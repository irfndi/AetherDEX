/**
 * AetherDEX TP/SL HTTP endpoints — Phase 2
 *
 * POST   /api/v1/tp-sl/orders         — Create a new TP/SL order (auth required)
 * GET    /api/v1/tp-sl/orders/:id     — Get order details (public)
 * DELETE /api/v1/tp-sl/orders/:id     — Cancel an order (auth required, owner only)
 * GET    /api/v1/tp-sl/pools/:poolId  — Get orders for a pool (public)
 * GET    /api/v1/tp-sl/users/:address — Get orders for a user (public)
 * GET    /api/v1/tp-sl/triggerable/:poolId — Get triggerable orders for a pool (public)
 */

import { Effect, Layer } from "effect"
import { Hono } from "hono"
import { type AuthVariables, requireAuth } from "../auth/middleware"
import { makeDbLayer } from "../db/client"
import { runEffect } from "../lib/effect-bridge"
import { ZERO_PROTOCOL_FEE_BREAKDOWN } from "../lib/protocol-fee"
import { TpSlService, TpSlServiceLive } from "../services/tp-sl.service"

type Bindings = {
  DB: D1Database
  CACHE: KVNamespace
  STORAGE: R2Bucket
  CHAIN_ID: string
  ENVIRONMENT: string
}

const tpSl = new Hono<{ Bindings: Bindings; Variables: AuthVariables }>()

const tpSlLayer = (db: D1Database) => TpSlServiceLive.pipe(Layer.provide(makeDbLayer(db)))
const chainIdFor = (c: { env: Bindings }) => Number.parseInt(c.env.CHAIN_ID, 10) || 11155111
const poolIdPattern = /^0x[a-fA-F0-9]{64}$/
const uintPattern = /^[0-9]+$/

// ─── POST /api/v1/tp-sl/orders ─────────────────────────────────────────────

tpSl.post("/orders", requireAuth, async (c) => {
  const session = c.get("session")
  if (!session) return c.json({ error: "Unauthorized" }, 401)

  const body = await c.req.json<{
    poolId?: string
    orderType?: string
    zeroForOne?: boolean
    amountIn?: string
    minAmountOut?: string
    triggerPriceX18?: string
    twapWindow?: number
    slippageBps?: number
    deadline?: number
  }>()

  if (
    !body.poolId ||
    !body.orderType ||
    body.zeroForOne === undefined ||
    !body.amountIn ||
    !body.minAmountOut ||
    !body.triggerPriceX18 ||
    !body.twapWindow ||
    body.slippageBps === undefined ||
    !body.deadline
  ) {
    return c.json(
      {
        error:
          "poolId, orderType, zeroForOne, amountIn, minAmountOut, triggerPriceX18, twapWindow, slippageBps, deadline required",
      },
      400,
    )
  }

  if (
    !poolIdPattern.test(body.poolId) ||
    typeof body.zeroForOne !== "boolean" ||
    !uintPattern.test(body.amountIn) ||
    !uintPattern.test(body.minAmountOut) ||
    !uintPattern.test(body.triggerPriceX18) ||
    !Number.isFinite(body.twapWindow) ||
    !Number.isInteger(body.twapWindow) ||
    !Number.isFinite(body.slippageBps) ||
    !Number.isInteger(body.slippageBps) ||
    body.slippageBps < 0 ||
    !Number.isFinite(body.deadline) ||
    !Number.isInteger(body.deadline) ||
    body.deadline <= Date.now()
  ) {
    return c.json({ error: "Invalid TP/SL order values" }, 400)
  }

  if (body.orderType !== "take_profit" && body.orderType !== "stop_loss") {
    return c.json({ error: "orderType must be 'take_profit' or 'stop_loss'" }, 400)
  }

  if (body.slippageBps > 500) {
    return c.json({ error: "slippageBps must be <= 500 (5%)" }, 400)
  }

  if (body.twapWindow <= 0 || body.twapWindow > 3600) {
    return c.json({ error: "twapWindow must be between 1 and 3600 seconds" }, 400)
  }

  // At this point all fields are validated as present
  const { poolId, orderType, zeroForOne, amountIn, minAmountOut, triggerPriceX18, twapWindow, slippageBps, deadline } =
    body

  try {
    const program = Effect.gen(function* () {
      const tpSlService = yield* TpSlService
      return yield* tpSlService.createOrder({
        userAddress: session.userAddress,
        poolId: poolId.toLowerCase(),
        orderType: orderType as "take_profit" | "stop_loss",
        zeroForOne,
        amountIn,
        minAmountOut,
        triggerPriceX18,
        twapWindow,
        slippageBps,
        deadline,
        chainId: chainIdFor(c),
      })
    })
    const orderId = await runEffect(program.pipe(Effect.provide(tpSlLayer(c.env.DB))))
    // Phase 4 fee invariant: TP/SL is protocol-fee-free (only deposits pay); additive metadata only.
    return c.json({ ok: true, orderId, protocolFee: ZERO_PROTOCOL_FEE_BREAKDOWN }, 201)
  } catch (err) {
    return c.json({ error: String(err) }, 500)
  }
})

// ─── GET /api/v1/tp-sl/orders/:id ───────────────────────────────────────────

tpSl.get("/orders/:id", async (c) => {
  const id = Number.parseInt(c.req.param("id") ?? "", 10)
  if (Number.isNaN(id) || id < 0) {
    return c.json({ error: "Invalid order id" }, 400)
  }

  try {
    const program = Effect.gen(function* () {
      const tpSlService = yield* TpSlService
      return yield* tpSlService.getOrder(id, chainIdFor(c))
    })
    const order = await runEffect(program.pipe(Effect.provide(tpSlLayer(c.env.DB))))
    if (!order) {
      return c.json({ error: "Order not found" }, 404)
    }
    return c.json({ order })
  } catch (err) {
    return c.json({ error: String(err) }, 500)
  }
})

// ─── DELETE /api/v1/tp-sl/orders/:id ────────────────────────────────────────

tpSl.delete("/orders/:id", requireAuth, async (c) => {
  const session = c.get("session")
  if (!session) return c.json({ error: "Unauthorized" }, 401)

  const id = Number.parseInt(c.req.param("id") ?? "", 10)
  if (Number.isNaN(id) || id < 0) {
    return c.json({ error: "Invalid order id" }, 400)
  }

  try {
    const program = Effect.gen(function* () {
      const tpSlService = yield* TpSlService
      return yield* tpSlService.cancelOrder(id, session.userAddress, chainIdFor(c))
    })
    await runEffect(program.pipe(Effect.provide(tpSlLayer(c.env.DB))))
    return c.json({ ok: true })
  } catch (err) {
    const error = err as { _tag?: string }
    if (error._tag === "OrderNotFoundError") {
      return c.json({ error: "Order not found or not owned by you" }, 404)
    }
    return c.json({ error: String(err) }, 500)
  }
})

// ─── GET /api/v1/tp-sl/pools/:poolId ────────────────────────────────────────

tpSl.get("/pools/:poolId", async (c) => {
  const poolId = c.req.param("poolId")
  if (!/^0x[a-fA-F0-9]{64}$/.test(poolId)) {
    return c.json({ error: "Invalid poolId (must be 0x + 64 hex chars)" }, 400)
  }

  const status = c.req.query("status") as string | undefined
  const validStatuses = ["pending", "triggered", "executed", "cancelled", "expired"] as const
  type ValidStatus = (typeof validStatuses)[number]
  const validatedStatus =
    status !== undefined && validStatuses.includes(status as ValidStatus) ? (status as ValidStatus) : undefined

  try {
    const program = Effect.gen(function* () {
      const tpSlService = yield* TpSlService
      return yield* tpSlService.listByPool(poolId.toLowerCase(), chainIdFor(c), validatedStatus)
    })
    const orders = await runEffect(program.pipe(Effect.provide(tpSlLayer(c.env.DB))))
    return c.json({ orders, count: orders.length })
  } catch (err) {
    return c.json({ error: String(err) }, 500)
  }
})

// ─── GET /api/v1/tp-sl/users/:address ───────────────────────────────────────

tpSl.get("/users/:address", async (c) => {
  const address = c.req.param("address")
  if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
    return c.json({ error: "Invalid address" }, 400)
  }

  try {
    const program = Effect.gen(function* () {
      const tpSlService = yield* TpSlService
      return yield* tpSlService.listByUser(address, chainIdFor(c), 100)
    })
    const orders = await runEffect(program.pipe(Effect.provide(tpSlLayer(c.env.DB))))
    return c.json({ orders, count: orders.length })
  } catch (err) {
    return c.json({ error: String(err) }, 500)
  }
})

// ─── GET /api/v1/tp-sl/triggerable/:poolId ──────────────────────────────────

tpSl.get("/triggerable/:poolId", async (c) => {
  const poolId = c.req.param("poolId")
  if (!/^0x[a-fA-F0-9]{64}$/.test(poolId)) {
    return c.json({ error: "Invalid poolId (must be 0x + 64 hex chars)" }, 400)
  }

  try {
    const program = Effect.gen(function* () {
      const tpSlService = yield* TpSlService
      return yield* tpSlService.getTriggerableOrders(poolId.toLowerCase(), chainIdFor(c))
    })
    const orders = await runEffect(program.pipe(Effect.provide(tpSlLayer(c.env.DB))))
    return c.json({ orders, count: orders.length })
  } catch (err) {
    return c.json({ error: String(err) }, 500)
  }
})

export { tpSl }
