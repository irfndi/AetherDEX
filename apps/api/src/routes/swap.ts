/**
 * AetherDEX Swap HTTP endpoints
 * Quote generation, calldata building, swap recording
 *
 * All data access flows through Effect services (G3): SwapService composes
 * PoolService (pool metadata) + ChainStateReader (on-chain V4 state, G2).
 */

import { Effect, Layer } from "effect"
import { Hono } from "hono"
import { type AuthVariables, requireAuth } from "../auth/middleware"
import { makeDbLayer } from "../db/client"
import { recordSwap } from "../db/queries"
import { runEffect } from "../lib/effect-bridge"
import {
  type ChainStateReader,
  makeStateViewReaderLayer,
  unconfiguredChainStateReaderLayer,
} from "../services/chain-state-reader"
import { PoolServiceLive } from "../services/pool.service"
import {
  type QuoteEngineMode,
  type SwapQuote,
  SwapService,
  SwapServiceDeps,
  SwapServiceLive,
} from "../services/swap.service"

const swap = new Hono<{ Bindings: Env; Variables: AuthVariables }>()

// ─── Address validation ──────────────────────────────────────────────────────

const ETH_ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/
const HEX_ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/

interface QuoteEnv {
  DB?: D1Database
  ROUTER_ADDRESS?: string
  FACTORY_ADDRESS?: string
  STATE_VIEW_ADDRESS?: string
  RPC_URL?: string
  CHAIN_ID?: string
  QUOTE_ENGINE_MODE?: string
}

/**
 * Build the SwapService layer stack for a request.
 * On-chain reads are deployment config (G5): when STATE_VIEW_ADDRESS + RPC_URL
 * are set we read V4 state live; otherwise the reader reports `not_configured`
 * and QUOTE_ENGINE_MODE=auto degrades to the legacy approximation.
 */
const swapServiceLayer = (env: QuoteEnv) => {
  const db = env.DB as D1Database
  const stateViewAddress = env.STATE_VIEW_ADDRESS ?? ""
  const rpcUrl = env.RPC_URL ?? ""
  const chainId = Number.parseInt(env.CHAIN_ID ?? "1", 10)

  const readerLayer: Layer.Layer<ChainStateReader> =
    HEX_ADDRESS_RE.test(stateViewAddress) && rpcUrl.length > 0
      ? makeStateViewReaderLayer({
          rpcUrl,
          stateViewAddress: stateViewAddress as `0x${string}`,
          chainId,
          tickScanEachSide: 64,
        })
      : unconfiguredChainStateReaderLayer

  const mode: QuoteEngineMode =
    env.QUOTE_ENGINE_MODE === "v4" || env.QUOTE_ENGINE_MODE === "legacy" ? env.QUOTE_ENGINE_MODE : "auto"

  const depsLayer = Layer.succeed(SwapServiceDeps, {
    routerAddress: env.ROUTER_ADDRESS ?? "",
    factoryAddress: env.FACTORY_ADDRESS ?? "",
    chainId,
    mode,
  })

  return SwapServiceLive.pipe(
    Layer.provide(PoolServiceLive.pipe(Layer.provide(makeDbLayer(db)))),
    Layer.provide(readerLayer),
    Layer.provide(depsLayer),
  )
}

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
    const program = Effect.gen(function* () {
      const swapService = yield* SwapService
      return yield* swapService.getQuote({
        tokenIn,
        tokenOut,
        amountIn,
        slippageTolerance,
      })
    })
    const quote = await Effect.runPromise(program.pipe(Effect.provide(swapServiceLayer(c.env))))
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
    const program = Effect.gen(function* () {
      const swapService = yield* SwapService
      return yield* swapService.buildCalldata(quote, recipient)
    })
    const calldata = await Effect.runPromise(program.pipe(Effect.provide(swapServiceLayer(c.env))))
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

  try {
    await runEffect(
      recordSwap({
        txHash: body.txHash,
        userAddress: session.userAddress,
        poolId: body.poolId ?? null,
        tokenIn: body.tokenIn ?? null,
        tokenOut: body.tokenOut ?? null,
        amountIn: body.amountIn ?? null,
        amountOut: body.amountOut ?? null,
        amountUsd: body.amountUsd ?? null,
        blockNumber: body.blockNumber,
        blockTimestamp: body.blockTimestamp,
      }).pipe(Effect.provide(makeDbLayer(c.env.DB as D1Database))),
    )

    return c.json({ ok: true, txHash: body.txHash })
  } catch (err) {
    return c.json({ error: String(err) }, 500)
  }
})

export { swap }
