import { Effect, Layer } from "effect"
import { Hono } from "hono"
import type { AuthVariables } from "../auth/middleware"
import { runEffect } from "../lib/effect-bridge"
import { ZERO_PROTOCOL_FEE_BREAKDOWN } from "../lib/protocol-fee"
import { rateLimit } from "../middleware/rate-limit"
import {
  V3QuoteError,
  type V3QuoteService,
  V3QuoteServiceDeps,
  V3QuoteServiceLive,
  V3QuoteService as V3QuoteServiceTag,
} from "../services/v3-quote.service"

const ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/
const FEE_RE = /^\d+$/

/** Canonical Uniswap V3 fee tiers (100/500/3000/10000 bps). */
const V3_FEE_TIERS: readonly number[] = [100, 500, 3_000, 10_000]
/** Max decimal digits for a uint256 amount (2^256 - 1 has 78 digits). */
const UINT256_MAX_DIGITS = 78

// Short-TTL in-memory quote cache: repeated identical requests are served
// without re-hitting the external RPC. Isolate-local by design — the KV-backed
// rate limiter is the cross-isolate throttle; this only dedupes hot quotes.
const QUOTE_CACHE_TTL_MS = 2_000
const quoteCache = new Map<string, { expiresAt: number; body: unknown }>()

const v3Quote = new Hono<{ Bindings: Env; Variables: AuthVariables }>()

v3Quote.get("/v3/quote", rateLimit(), async (c) => {
  const tokenIn = c.req.query("tokenIn")
  const tokenOut = c.req.query("tokenOut")
  const amountInRaw = c.req.query("amountIn")
  const feeRaw = c.req.query("fee")
  const slippage = Number.parseFloat(c.req.query("slippage") ?? "0.5")
  if (!tokenIn || !tokenOut || !amountInRaw || !feeRaw) {
    return c.json({ error: "tokenIn, tokenOut, amountIn, and fee are required" }, 400)
  }
  if (!ADDRESS_RE.test(tokenIn) || !ADDRESS_RE.test(tokenOut) || !FEE_RE.test(amountInRaw) || !FEE_RE.test(feeRaw)) {
    return c.json({ error: "Invalid v3 quote parameters" }, 400)
  }
  // Bound the BigInt parse before it runs: >78 digits is beyond uint256 anyway,
  // and unbounded digit strings make the decimal-string conversion super-linear.
  if (amountInRaw.length > UINT256_MAX_DIGITS) {
    return c.json({ error: "amountIn must not exceed uint256 (max 78 digits)" }, 400)
  }
  const amountIn = BigInt(amountInRaw)
  const fee = Number(feeRaw)
  if (amountIn <= 0n || !Number.isSafeInteger(fee)) {
    return c.json({ error: "Invalid v3 quote amount or fee" }, 400)
  }
  if (!V3_FEE_TIERS.includes(fee)) {
    return c.json({ error: "fee must be one of 100, 500, 3000, 10000" }, 400)
  }
  if (!Number.isFinite(slippage) || slippage < 0 || slippage > 5) {
    return c.json({ error: "Slippage must be between 0% and 5%" }, 400)
  }
  const rpcUrl = c.env.RPC_URL
  const factoryAddress = c.env.V3_FACTORY_ADDRESS
  const quoterAddress = c.env.V3_QUOTER_ADDRESS
  if (!rpcUrl || !ADDRESS_RE.test(factoryAddress ?? "") || !ADDRESS_RE.test(quoterAddress ?? "")) {
    return c.json({ error: "V3 quote service is not configured" }, 503)
  }

  const cacheKey = `${tokenIn}|${tokenOut}|${amountInRaw}|${feeRaw}|${slippage}`
  const cached = quoteCache.get(cacheKey)
  if (cached && cached.expiresAt > Date.now()) {
    return c.json(cached.body)
  }

  try {
    const layer = V3QuoteServiceLive.pipe(
      Layer.provide(
        Layer.succeed(V3QuoteServiceDeps, {
          rpcUrl,
          factoryAddress: factoryAddress as `0x${string}`,
          quoterAddress: quoterAddress as `0x${string}`,
          chainId: Number.parseInt(c.env.CHAIN_ID, 10) || 11155111,
        }),
      ),
    )
    const result = await runEffect(
      Effect.gen(function* () {
        const service: V3QuoteService = yield* V3QuoteServiceTag
        return yield* service.quote({ tokenIn, tokenOut, fee, amountIn })
      }).pipe(Effect.provide(layer)),
    )
    const slippageBps = BigInt(Math.round(slippage * 100))
    const body = {
      amountOut: result.amountOut.toString(),
      minAmountOut: ((result.amountOut * (10_000n - slippageBps)) / 10_000n).toString(),
      initializedTicksCrossed: result.initializedTicksCrossed,
      gasEstimate: result.gasEstimate.toString(),
      // Phase 4 fee invariant: swaps are protocol-fee-free (only deposits pay); additive metadata only.
      protocolFee: ZERO_PROTOCOL_FEE_BREAKDOWN,
    }
    quoteCache.set(cacheKey, { expiresAt: Date.now() + QUOTE_CACHE_TTL_MS, body })
    return c.json(body)
  } catch (error) {
    console.error("[v3-quote] quote failed:", error)
    const reason = error instanceof V3QuoteError ? error.reason : "rpc_error"
    // rpc_error wraps provider errors (which can embed the RPC URL) — never echo them;
    // no_pool / invalid_amount carry client-safe messages.
    const message = error instanceof V3QuoteError && reason !== "rpc_error" ? error.message : "Quote failed"
    const status = reason === "no_pool" ? 404 : reason === "invalid_amount" ? 400 : 503
    return c.json({ error: message, reason }, status)
  }
})

export { v3Quote }
