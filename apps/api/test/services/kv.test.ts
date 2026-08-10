/**
 * KV cache service — corrupt/foreign entries must degrade to `none`, never
 * escape as an Effect defect.
 */

import { Effect, Option } from "effect"
import { describe, expect, it } from "vitest"
import { KVCacheService } from "../../src/services/kv"

const makeKv = (value: string | null) => ({ get: async () => value }) as unknown as KVNamespace

const readPrice = (kv: KVNamespace, tokenAddress: string) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const svc = yield* KVCacheService
      return yield* svc.getPrice(kv, tokenAddress)
    }).pipe(Effect.provide(KVCacheService.layer)),
  )

describe("KVCacheService", () => {
  it("getPrice returns none for a corrupt KV payload instead of dying", async () => {
    const result = await readPrice(makeKv("not-json{"), "0xabc")
    expect(Option.isNone(result)).toBe(true)
  })

  it("getSession returns none for a corrupt KV payload instead of dying", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* KVCacheService
        return yield* svc.getSession(makeKv('{"userAddress":'), "tok")
      }).pipe(Effect.provide(KVCacheService.layer)),
    )
    expect(Option.isNone(result)).toBe(true)
  })

  it("getPrice still parses a well-formed entry", async () => {
    const result = await readPrice(
      makeKv(JSON.stringify({ tokenAddress: "0xabc", priceUsd: 1.5, updatedAt: 1 })),
      "0xabc",
    )
    expect(Option.isSome(result)).toBe(true)
    if (Option.isSome(result)) {
      expect(result.value.priceUsd).toBe(1.5)
    }
  })
})
