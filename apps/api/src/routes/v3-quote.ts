import { Effect, Layer } from "effect"
import { Hono } from "hono"
import { runEffect } from "../lib/effect-bridge"
import {
  V3QuoteError,
  type V3QuoteService,
  V3QuoteServiceDeps,
  V3QuoteServiceLive,
  V3QuoteService as V3QuoteServiceTag,
} from "../services/v3-quote.service"

const ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/
const FEE_RE = /^\d+$/

const v3Quote = new Hono<{ Bindings: Env }>()

v3Quote.get("/v3/quote", async (c) => {
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
  const amountIn = BigInt(amountInRaw)
  const fee = Number(feeRaw)
  if (amountIn <= 0n || !Number.isSafeInteger(fee) || fee <= 0 || fee > 1_000_000) {
    return c.json({ error: "Invalid v3 quote amount or fee" }, 400)
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
  try {
    const layer = V3QuoteServiceLive.pipe(
      Layer.provide(
        Layer.succeed(V3QuoteServiceDeps, {
          rpcUrl,
          factoryAddress: factoryAddress as `0x${string}`,
          quoterAddress: quoterAddress as `0x${string}`,
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
    return c.json({
      amountOut: result.amountOut.toString(),
      minAmountOut: ((result.amountOut * (10_000n - slippageBps)) / 10_000n).toString(),
      initializedTicksCrossed: result.initializedTicksCrossed,
      gasEstimate: result.gasEstimate.toString(),
    })
  } catch (error) {
    const reason = error instanceof V3QuoteError ? error.reason : "rpc_error"
    const message = error instanceof V3QuoteError ? error.message : String(error)
    return c.json({ error: message, reason }, reason === "no_pool" ? 404 : 503)
  }
})

export { v3Quote }
