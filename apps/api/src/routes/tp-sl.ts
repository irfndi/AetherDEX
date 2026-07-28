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
import { createPublicClient, decodeEventLog, getAddress, http, isAddress } from "viem"
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
  RPC_URL?: string
  TPSL_ADDRESS?: string
  AETHER_TPSL_ADDRESS?: string
}

const tpSl = new Hono<{ Bindings: Bindings; Variables: AuthVariables }>()

const tpSlLayer = (db: D1Database) => TpSlServiceLive.pipe(Layer.provide(makeDbLayer(db)))
const chainIdFor = (c: { env: Bindings }) => Number.parseInt(c.env.CHAIN_ID, 10) || 11155111
const poolIdPattern = /^0x[a-fA-F0-9]{64}$/
const uintPattern = /^[0-9]+$/
const transactionHashPattern = /^0x[a-fA-F0-9]{64}$/
const ORDER_CREATED_ABI = [
  {
    type: "event",
    name: "OrderCreated",
    inputs: [
      { indexed: true, name: "orderId", type: "uint256" },
      { indexed: true, name: "owner", type: "address" },
      { indexed: false, name: "orderType", type: "uint8" },
      { indexed: true, name: "poolId", type: "bytes32" },
      { indexed: false, name: "zeroForOne", type: "bool" },
      { indexed: false, name: "amountIn", type: "uint128" },
      { indexed: false, name: "triggerPriceX18", type: "uint256" },
    ],
  },
] as const

const TPSL_ORDER_ABI = [
  {
    type: "function",
    name: "getOrder",
    stateMutability: "view",
    inputs: [{ name: "orderId", type: "uint256" }],
    outputs: [
      {
        name: "order",
        type: "tuple",
        components: [
          { name: "id", type: "uint256" },
          { name: "owner", type: "address" },
          { name: "orderType", type: "uint8" },
          {
            name: "poolKey",
            type: "tuple",
            components: [
              { name: "currency0", type: "address" },
              { name: "currency1", type: "address" },
              { name: "fee", type: "uint24" },
              { name: "tickSpacing", type: "int24" },
              { name: "hooks", type: "address" },
            ],
          },
          { name: "zeroForOne", type: "bool" },
          { name: "amountIn", type: "uint128" },
          { name: "minAmountOut", type: "uint128" },
          { name: "triggerPriceX18", type: "uint256" },
          { name: "twapWindow", type: "uint32" },
          { name: "slippageBps", type: "uint256" },
          { name: "deadline", type: "uint256" },
          { name: "status", type: "uint8" },
          { name: "createdAt", type: "uint256" },
          { name: "executedAt", type: "uint256" },
        ],
      },
    ],
  },
] as const

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
    creationTxHash?: string
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
    !body.deadline ||
    !body.creationTxHash
  ) {
    return c.json(
      {
        error:
          "poolId, orderType, zeroForOne, amountIn, minAmountOut, triggerPriceX18, twapWindow, slippageBps, deadline, creationTxHash required",
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
    body.deadline <= Date.now() ||
    !transactionHashPattern.test(body.creationTxHash)
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
    const tpslAddress = bodyAddress(c.env.TPSL_ADDRESS) ?? bodyAddress(c.env.AETHER_TPSL_ADDRESS)
    if (!tpslAddress || !c.env.RPC_URL) {
      return c.json({ error: "TPSL_ADDRESS and RPC_URL are required to verify creationTxHash" }, 503)
    }
    const publicClient = createPublicClient({ transport: http(c.env.RPC_URL) })
    if ((await publicClient.getChainId()) !== chainIdFor(c)) {
      return c.json({ error: "RPC_URL chain does not match CHAIN_ID" }, 503)
    }
    const receipt = await publicClient.getTransactionReceipt({
      hash: body.creationTxHash as `0x${string}`,
    })
    if (receipt.status !== "success") return c.json({ error: "creationTxHash transaction reverted" }, 400)
    const event = receipt.logs
      .filter((log) => log.address.toLowerCase() === tpslAddress.toLowerCase())
      .map((log) => {
        try {
          return decodeEventLog({ abi: ORDER_CREATED_ABI, data: log.data, topics: log.topics })
        } catch {
          return null
        }
      })
      .find((decoded) => decoded?.eventName === "OrderCreated")
    if (!event || event.eventName !== "OrderCreated") return c.json({ error: "No valid OrderCreated event found" }, 400)
    const eventArgs = event.args
    const expectedType = orderType === "take_profit" ? 0 : 1
    if (
      eventArgs.owner.toLowerCase() !== session.userAddress.toLowerCase() ||
      eventArgs.poolId.toLowerCase() !== poolId.toLowerCase() ||
      eventArgs.orderType !== expectedType ||
      eventArgs.zeroForOne !== zeroForOne ||
      eventArgs.amountIn.toString() !== amountIn ||
      eventArgs.triggerPriceX18.toString() !== triggerPriceX18
    ) {
      return c.json({ error: "OrderCreated event does not match the requested TP/SL order" }, 400)
    }
    const onchainOrder = await publicClient.readContract({
      address: tpslAddress,
      abi: TPSL_ORDER_ABI,
      functionName: "getOrder",
      args: [eventArgs.orderId],
    })
    if (
      onchainOrder.id !== eventArgs.orderId ||
      onchainOrder.owner.toLowerCase() !== session.userAddress.toLowerCase() ||
      onchainOrder.orderType !== expectedType ||
      onchainOrder.zeroForOne !== zeroForOne ||
      onchainOrder.amountIn.toString() !== amountIn ||
      onchainOrder.minAmountOut.toString() !== minAmountOut ||
      onchainOrder.triggerPriceX18.toString() !== triggerPriceX18 ||
      Number(onchainOrder.twapWindow) !== twapWindow ||
      onchainOrder.slippageBps.toString() !== String(slippageBps) ||
      onchainOrder.deadline !== BigInt(Math.floor(deadline / 1000)) ||
      onchainOrder.status !== 0
    ) {
      return c.json({ error: "On-chain TP/SL order does not match the requested parameters" }, 400)
    }
    const onchainOrderId = eventArgs.orderId.toString()
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
        onchainOrderId,
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

function bodyAddress(value: string | undefined): `0x${string}` | null {
  if (!value || !isAddress(value)) return null
  return getAddress(value)
}

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
