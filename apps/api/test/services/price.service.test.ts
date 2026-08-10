/**
 * Price service — D1 rows stored in epoch-milliseconds must not have their
 * updatedAt double-converted.
 */

import { Effect, Layer } from "effect"
import { describe, expect, it } from "vitest"
import { PriceService, PriceServiceDeps, PriceServiceLive } from "../../src/services/price.service"

const NOW = Date.now()
const MS_TS = NOW
const SECONDS_TS = Math.floor(NOW / 1000)

const kv = { get: async () => null, put: async () => undefined } as unknown as KVNamespace

const layerWithRow = (updatedAt: number) =>
  PriceServiceLive.pipe(
    Layer.provide(
      Layer.succeed(PriceServiceDeps, {
        kv,
        db: {
          prepare: () => ({
            bind: () => ({ first: async () => ({ price_usd: 1.5, updated_at: updatedAt }) }),
          }),
        } as unknown as D1Database,
      }),
    ),
  )

describe("PriceService.readD1Price", () => {
  it("keeps epoch-ms updatedAt as-is (no *1000 double conversion)", async () => {
    const data = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* PriceService
        return yield* svc.getPrice("0xabc", 1)
      }).pipe(Effect.provide(layerWithRow(MS_TS))),
    )
    expect(data.updatedAt).toBe(MS_TS)
    expect(data.priceUsd).toBe(1.5)
    expect(data.source).toBe("d1-cache")
  })

  it("converts epoch-seconds updatedAt to ms", async () => {
    const data = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* PriceService
        return yield* svc.getPrice("0xabc", 1)
      }).pipe(Effect.provide(layerWithRow(SECONDS_TS))),
    )
    expect(data.updatedAt).toBe(SECONDS_TS * 1000)
  })
})
