/**
 * AetherDEX Swap HTTP endpoints
 * Quote generation, calldata building, swap recording
 *
 * All data access flows through Effect services (G3): SwapService composes
 * PoolService (pool metadata) + ChainStateReader (on-chain V4 state, G2).
 */

import { Effect, Layer } from "effect"
import { Hono } from "hono"
import { createPublicClient, http } from "viem"
import { type AuthVariables, requireAuth } from "../auth/middleware"
import { makeDbLayer } from "../db/client"
import { recordSwap } from "../db/queries"
import { parseChainId } from "../lib/chain-id"
import { runEffect } from "../lib/effect-bridge"
import { ZERO_PROTOCOL_FEE_BREAKDOWN } from "../lib/protocol-fee"
import { readCircuitBreakerConfig, type SafetyEnv } from "../lib/safety-config"
import { circuitBreaker } from "../middleware/circuit-breaker"
import { mevProtection } from "../middleware/mev-protection"
import { rateLimit } from "../middleware/rate-limit"
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

// ─── Phase-3 safety helpers (rate limit / circuit breaker / MEV) ─────────────
// Body reads here share Hono's per-request body cache, so handlers still parse
// the exact same payload exactly once.

interface BuildRequestBody {
  quote?: SwapQuote & { amountUsd?: number }
  recipient?: string
  slippageTolerance?: number
  amountUsd?: number
}

type BodyReader = (c: { req: { json: <T>() => Promise<T> } }) => Promise<number | null>

const toFiniteNumber = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null

const readBuildSlippageBps: BodyReader = async (c) => {
  const body = await c.req.json<BuildRequestBody>().catch(() => null)
  const tolerance = body?.slippageTolerance
  return typeof tolerance === "number" && Number.isFinite(tolerance) ? Math.round(Math.abs(tolerance) * 10_000) : null
}

const readBuildAmountUsd: BodyReader = async (c) => {
  const body = await c.req.json<BuildRequestBody>().catch(() => null)
  return toFiniteNumber(body?.amountUsd) ?? toFiniteNumber(body?.quote?.amountUsd)
}

const readRecordAmountUsd: BodyReader = async (c) => {
  const body = await c.req.json<{ amountUsd?: unknown }>().catch(() => null)
  return toFiniteNumber(body?.amountUsd)
}

const highValueRequest =
  (readUsd: BodyReader) =>
  async (c: { env: unknown; req: { json: <T>() => Promise<T> } }): Promise<boolean> => {
    const { highValueUsdThreshold } = readCircuitBreakerConfig(c.env as SafetyEnv)
    if (highValueUsdThreshold === undefined) return false
    const usd = await readUsd(c)
    return usd !== null && usd >= highValueUsdThreshold
  }

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
  const chainId = parseChainId(env.CHAIN_ID)
  if (chainId === null) throw new Error("Invalid chain configuration")

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

  if (!tokenIn || !tokenOut || !amountIn) {
    return c.json({ error: "Missing required query params: tokenIn, tokenOut, amountIn" }, 400)
  }

  if (!ETH_ADDRESS_RE.test(tokenIn) || !ETH_ADDRESS_RE.test(tokenOut)) {
    return c.json({ error: "Invalid token address" }, 400)
  }

  // Slippage is a percentage (0.5 = 0.5%). NaN (abc), negative, and unbounded
  // values would flow into the quote and null out minAmountOut (silently
  // disabling client slippage protection) — reject them up front.
  const slippagePercent = Number.parseFloat(c.req.query("slippage") ?? "0.5")
  if (!Number.isFinite(slippagePercent) || slippagePercent < 0 || slippagePercent > 100) {
    return c.json({ error: "Slippage must be between 0% and 100%" }, 400)
  }
  const slippageTolerance = slippagePercent / 100

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
    // Phase 4 fee invariant: swaps are protocol-fee-free (only deposits pay); additive metadata only.
    return c.json({ ...quote, protocolFee: ZERO_PROTOCOL_FEE_BREAKDOWN })
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
swap.post(
  "/build",
  rateLimit(),
  circuitBreaker({ name: "swap", isHighValueRequest: highValueRequest(readBuildAmountUsd) }),
  mevProtection({ readSlippageBps: readBuildSlippageBps, readAmountUsd: readBuildAmountUsd }),
  async (c) => {
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
      // Phase 4 fee invariant: swap calldata carries no protocol fee; additive indicator only.
      return c.json({ ...calldata, protocolFee: ZERO_PROTOCOL_FEE_BREAKDOWN })
    } catch (err) {
      return c.json({ error: String(err) }, 500)
    }
  },
)

// ─── POST /swap/record ───────────────────────────────────────────────────────

/**
 * POST /api/v1/swap/record
 * Record a confirmed swap transaction for indexing
 * Requires auth (only the user's own transactions)
 */
swap.post(
  "/record",
  rateLimit(),
  circuitBreaker({ name: "swap", isHighValueRequest: highValueRequest(readRecordAmountUsd) }),
  requireAuth,
  async (c) => {
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

    const chainId = parseChainId(c.env.CHAIN_ID)
    if (chainId === null) {
      return c.json({ error: "Invalid chain configuration" }, 500)
    }

    // Strict shape checks: fabricated rows must fail before any on-chain or D1 work.
    const TX_HASH_RE = /^0x[a-fA-F0-9]{64}$/
    const POOL_ID_RE = /^0x[a-fA-F0-9]{64}$/
    const TOKEN_ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/
    const UINT_RE = /^\d+$/
    if (!TX_HASH_RE.test(body.txHash)) {
      return c.json({ error: "Invalid txHash (must be 0x + 64 hex chars)" }, 400)
    }
    if (!Number.isSafeInteger(body.blockNumber) || body.blockNumber <= 0) {
      return c.json({ error: "Invalid blockNumber (must be a positive integer)" }, 400)
    }
    if (!Number.isSafeInteger(body.blockTimestamp) || body.blockTimestamp <= 0) {
      return c.json({ error: "Invalid blockTimestamp (must be a positive integer)" }, 400)
    }
    if (body.poolId !== undefined && !POOL_ID_RE.test(body.poolId)) {
      return c.json({ error: "Invalid poolId (must be 0x + 64 hex chars)" }, 400)
    }
    if (body.tokenIn !== undefined && !TOKEN_ADDRESS_RE.test(body.tokenIn)) {
      return c.json({ error: "Invalid tokenIn address" }, 400)
    }
    if (body.tokenOut !== undefined && !TOKEN_ADDRESS_RE.test(body.tokenOut)) {
      return c.json({ error: "Invalid tokenOut address" }, 400)
    }
    if (body.amountIn !== undefined && !UINT_RE.test(body.amountIn)) {
      return c.json({ error: "Invalid amountIn (must be a non-negative integer string)" }, 400)
    }
    if (body.amountOut !== undefined && !UINT_RE.test(body.amountOut)) {
      return c.json({ error: "Invalid amountOut (must be a non-negative integer string)" }, 400)
    }
    if (body.amountUsd !== undefined && (!Number.isFinite(body.amountUsd) || body.amountUsd < 0)) {
      return c.json({ error: "Invalid amountUsd (must be a non-negative number)" }, 400)
    }

    try {
      // Verify the tx on-chain before persisting: receipt succeeded and the sender
      // is the authenticated wallet (mirrors tp-sl creation verification). Without
      // an RPC endpoint no receipt can be verified, so recording is refused.
      const rpcUrl = c.env.RPC_URL
      if (!rpcUrl) {
        return c.json({ error: "Swap verification is not configured (RPC_URL required)" }, 503)
      }
      const publicClient = createPublicClient({ transport: http(rpcUrl) })
      if ((await publicClient.getChainId()) !== chainId) {
        return c.json({ error: "RPC_URL chain does not match CHAIN_ID" }, 503)
      }
      const receipt = await publicClient.getTransactionReceipt({ hash: body.txHash as `0x${string}` })
      if (receipt.status !== "success") {
        return c.json({ error: "Transaction did not succeed on-chain" }, 400)
      }
      if (receipt.from.toLowerCase() !== session.userAddress.toLowerCase()) {
        return c.json({ error: "Transaction sender does not match the authenticated wallet" }, 403)
      }

      await runEffect(
        recordSwap({
          chainId,
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
  },
)

export { swap }
