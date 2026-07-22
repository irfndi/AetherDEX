/**
 * Phase-0 G2 — ChainStateReader abstraction: mock reads + unconfigured path
 * (live StateView reads are G5/deployment-gated).
 */

import { Effect } from "effect"
import { describe, expect, it } from "vitest"
import {
  ChainStateReader,
  mockChainStateReaderLayer,
  OnChainReadError,
  unconfiguredChainStateReaderLayer,
} from "../../src/services/chain-state-reader"
import type { PoolChainState, PoolKeyParams } from "../../src/services/quote-engine"

const key: PoolKeyParams = {
  token0: "0x0000000000000000000000000000000000000001",
  token1: "0x0000000000000000000000000000000000000002",
  fee: 3000,
  tickSpacing: 60,
  hooks: "0x0000000000000000000000000000000000000000",
}

const state: PoolChainState = {
  sqrtPriceX96: 2n ** 96n,
  tick: 0,
  liquidity: 10n ** 18n,
  initializedTicks: [],
}

describe("ChainStateReader", () => {
  it("mockChainStateReaderLayer resolves state keyed by pool id", async () => {
    const layer = mockChainStateReaderLayer(new Map([["pool-1", state]]), () => "pool-1")
    const got = await Effect.runPromise(
      Effect.gen(function* () {
        const reader = yield* ChainStateReader
        return yield* reader.getPoolState(key)
      }).pipe(Effect.provide(layer)),
    )
    expect(got.liquidity).toBe(10n ** 18n)
    expect(got.tick).toBe(0)
  })

  it("mockChainStateReaderLayer fails pool_not_initialized for unknown pools", async () => {
    const layer = mockChainStateReaderLayer(new Map(), () => "missing")
    const err = await Effect.runPromise(
      Effect.gen(function* () {
        const reader = yield* ChainStateReader
        return yield* reader.getPoolState(key)
      }).pipe(Effect.provide(layer), Effect.flip),
    )
    expect(err).toBeInstanceOf(OnChainReadError)
    expect((err as OnChainReadError).reason).toBe("pool_not_initialized")
  })

  it("unconfiguredChainStateReaderLayer fails not_configured (pre-G5)", async () => {
    const err = await Effect.runPromise(
      Effect.gen(function* () {
        const reader = yield* ChainStateReader
        return yield* reader.getPoolState(key)
      }).pipe(Effect.provide(unconfiguredChainStateReaderLayer), Effect.flip),
    )
    expect(err).toBeInstanceOf(OnChainReadError)
    expect((err as OnChainReadError).reason).toBe("not_configured")
  })
})
