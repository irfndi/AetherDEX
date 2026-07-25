/**
 * Phase-0 G2 — ChainStateReader abstraction: mock reads + unconfigured path
 * (live StateView reads are G5/deployment-gated).
 */

import { Effect } from "effect"
import { describe, expect, it } from "vitest"
import {
  ChainStateReader,
  makeStateViewReaderLayer,
  mockChainStateReaderLayer,
  OnChainReadError,
  type StateViewClient,
  type StateViewReaderConfig,
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

const liveConfig: StateViewReaderConfig = {
  rpcUrl: "https://rpc.example",
  stateViewAddress: "0x0000000000000000000000000000000000000003",
  chainId: 1,
  tickScanEachSide: 1,
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

  it("rejects a StateView client on the wrong chain before reading state", async () => {
    const client: StateViewClient = {
      getChainId: async () => 10,
      getBlockNumber: async () => 42n,
      getSlot0: async () => [2n ** 96n, 0],
      getLiquidity: async () => 1n,
      getTickLiquidity: async () => [0n, 0n],
    }
    const layer = makeStateViewReaderLayer(liveConfig, () => client)
    const err = await Effect.runPromise(
      Effect.gen(function* () {
        const reader = yield* ChainStateReader
        return yield* reader.getPoolState(key)
      }).pipe(Effect.provide(layer), Effect.flip),
    )

    expect(err).toBeInstanceOf(OnChainReadError)
    expect((err as OnChainReadError).reason).toBe("rpc_chain_mismatch")
  })

  it("pins every StateView read to the captured block", async () => {
    const blocks: bigint[] = []
    const client: StateViewClient = {
      getChainId: async () => 1,
      getBlockNumber: async () => 42n,
      getSlot0: async (_poolId, blockNumber) => {
        blocks.push(blockNumber)
        return [2n ** 96n, 1]
      },
      getLiquidity: async (_poolId, blockNumber) => {
        blocks.push(blockNumber)
        return 1n
      },
      getTickLiquidity: async (_poolId, _tick, blockNumber) => {
        blocks.push(blockNumber)
        return [0n, 0n]
      },
    }
    const layer = makeStateViewReaderLayer(liveConfig, () => client)
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const reader = yield* ChainStateReader
        return yield* reader.getPoolState(key)
      }).pipe(Effect.provide(layer)),
    )

    expect(result.sqrtPriceX96).toBe(2n ** 96n)
    expect(blocks.length).toBe(5)
    expect(blocks.every((blockNumber) => blockNumber === 42n)).toBe(true)
  })
})
