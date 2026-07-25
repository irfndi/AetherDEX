import { Effect, Layer } from "effect"
import { Hono } from "hono"
import { runEffect } from "../lib/effect-bridge"
import { PriceService, PriceServiceDeps, PriceServiceLive } from "../services/price.service"

type Bindings = {
  DB: D1Database
  CACHE: KVNamespace
}

const ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/
const DECIMAL_RE = /^\d+(\.\d+)?$/
const DEFAULT_MAX_DEVIATION_BPS = 500
const MAX_DEVIATION_BPS = 2_000

export interface PriceGuardResult {
  readonly valid: boolean
  readonly token0PriceUsd: number
  readonly token1PriceUsd: number
  readonly expectedPrice: number
  readonly requestedPrice: number
  readonly deviationBps: number
  readonly maxDeviationBps: number
  readonly checkedAt: number
}

export function evaluatePriceGuard(
  token0PriceUsd: number,
  token1PriceUsd: number,
  requestedPrice: number,
  maxDeviationBps: number,
  checkedAt = Date.now(),
): PriceGuardResult {
  if (
    !Number.isFinite(token0PriceUsd) ||
    !Number.isFinite(token1PriceUsd) ||
    token0PriceUsd <= 0 ||
    token1PriceUsd <= 0 ||
    !Number.isFinite(requestedPrice) ||
    requestedPrice <= 0
  ) {
    throw new Error("Price guard requires positive finite prices")
  }
  const expectedPrice = token1PriceUsd / token0PriceUsd
  const deviationBps = Math.round((Math.abs(requestedPrice - expectedPrice) / expectedPrice) * 10_000)
  return {
    valid: deviationBps <= maxDeviationBps,
    token0PriceUsd,
    token1PriceUsd,
    expectedPrice,
    requestedPrice,
    deviationBps,
    maxDeviationBps,
    checkedAt,
  }
}

const priceGuard = new Hono<{ Bindings: Bindings }>()

priceGuard.get("/price-guard", async (c) => {
  const token0 = c.req.query("token0")
  const token1 = c.req.query("token1")
  const requestedPriceRaw = c.req.query("price")
  const maxDeviationRaw = c.req.query("maxDeviationBps")
  const maxDeviationBps = maxDeviationRaw ? Number(maxDeviationRaw) : DEFAULT_MAX_DEVIATION_BPS

  if (!token0 || !token1 || !requestedPriceRaw) {
    return c.json({ error: "token0, token1, and price are required" }, 400)
  }
  if (!ADDRESS_RE.test(token0) || !ADDRESS_RE.test(token1) || token0.toLowerCase() >= token1.toLowerCase()) {
    return c.json({ error: "Tokens must be distinct, valid, and sorted" }, 400)
  }
  if (!DECIMAL_RE.test(requestedPriceRaw)) return c.json({ error: "price must be a positive decimal" }, 400)
  const requestedPrice = Number(requestedPriceRaw)
  if (!Number.isFinite(requestedPrice) || requestedPrice <= 0) {
    return c.json({ error: "price must be a positive finite number" }, 400)
  }
  if (!Number.isSafeInteger(maxDeviationBps) || maxDeviationBps <= 0 || maxDeviationBps > MAX_DEVIATION_BPS) {
    return c.json({ error: `maxDeviationBps must be an integer from 1 to ${MAX_DEVIATION_BPS}` }, 400)
  }

  try {
    const layer = PriceServiceLive.pipe(
      Layer.provide(
        Layer.succeed(PriceServiceDeps, {
          kv: c.env.CACHE,
          db: c.env.DB,
        }),
      ),
    )
    const result = await runEffect(
      Effect.gen(function* () {
        const service = yield* PriceService
        const [token0Price, token1Price] = yield* Effect.all(
          [service.refreshPrice(token0), service.refreshPrice(token1)],
          { concurrency: 2 },
        )
        return evaluatePriceGuard(token0Price.priceUsd, token1Price.priceUsd, requestedPrice, maxDeviationBps)
      }).pipe(Effect.provide(layer)),
    )
    return c.json(result, result.valid ? 200 : 422)
  } catch (error) {
    return c.json({ error: `Price guard unavailable: ${String(error)}` }, 503)
  }
})

export { priceGuard }
