/**
 * Swap service — buildCalldata must surface typed SwapQuoteError failures
 * (not Effect defects) and must reject stale quotes with reason "expired".
 */

import { Effect, Layer } from "effect"
import { describe, expect, it } from "vitest"
import { unconfiguredChainStateReaderLayer } from "../../src/services/chain-state-reader"
import { PoolService } from "../../src/services/pool.service"
import {
  type SwapQuote,
  SwapQuoteError,
  SwapService,
  SwapServiceDeps,
  SwapServiceLive,
} from "../../src/services/swap.service"

const ROUTER = "0x00000000000000000000000000000000000000aa"
const FACTORY = "0x00000000000000000000000000000000000000bb"
const RECIPIENT = "0x00000000000000000000000000000000000000cc"

const noPoolService = {
  getPool: () => Effect.succeed(null),
  listPools: () => Effect.succeed([]),
  getPoolByTokens: () => Effect.succeed(null),
  refreshPool: () => Effect.succeed(undefined),
} as unknown as PoolService

const layer = SwapServiceLive.pipe(
  Layer.provide(
    Layer.succeed(SwapServiceDeps, { routerAddress: ROUTER, factoryAddress: FACTORY, chainId: 1, mode: "legacy" }),
  ),
  Layer.provide(Layer.succeed(PoolService, noPoolService)),
  Layer.provide(unconfiguredChainStateReaderLayer),
)

const quote = (overrides: Partial<SwapQuote> = {}): SwapQuote => ({
  poolId: "0x0000000000000000000000000000000000000000000000000000000000000001",
  tokenIn: "0x0000000000000000000000000000000000000001",
  tokenOut: "0x0000000000000000000000000000000000000002",
  amountIn: "1000000",
  amountOut: "900000",
  minAmountOut: "890000",
  priceImpact: 0.01,
  fee: 3000,
  gasEstimate: "250000",
  expiresAt: Date.now() + 60_000,
  ...overrides,
})

/** First cause reason of a failed exit: { _tag: "Fail", failure } or { _tag: "Die", defect }. */
const firstReason = (exit: { cause?: { reasons?: readonly unknown[] } }) =>
  (exit.cause?.reasons?.[0] ?? {}) as { _tag?: string; error?: unknown; defect?: unknown }

const runBuildCalldata = (q: SwapQuote) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const svc = yield* SwapService
      return yield* svc.buildCalldata(q, RECIPIENT)
    }).pipe(Effect.provide(layer), Effect.exit),
  )

describe("SwapService.buildCalldata", () => {
  it("fails with a typed SwapQuoteError (not a defect) for an unknown pool", async () => {
    const exit = await runBuildCalldata(quote())
    expect(exit._tag).toBe("Failure")
    if (exit._tag !== "Failure") return
    // Typed failure surfaces as a Fail reason; the old Effect.die surfaced as Die.
    expect(firstReason(exit)._tag).toBe("Fail")
    expect(firstReason(exit).error).toBeInstanceOf(SwapQuoteError)
    expect((firstReason(exit).error as SwapQuoteError).reason).toBe("no_pool")
  })

  it("rejects an expired quote with reason 'expired' and produces no calldata", async () => {
    const exit = await runBuildCalldata(quote({ expiresAt: Date.now() - 1_000 }))
    expect(exit._tag).toBe("Failure")
    if (exit._tag !== "Failure") return
    expect(firstReason(exit)._tag).toBe("Fail")
    expect(firstReason(exit).error).toBeInstanceOf(SwapQuoteError)
    expect((firstReason(exit).error as SwapQuoteError).reason).toBe("expired")
  })
})

describe("SwapService.getQuote", () => {
  it("rejects a deadline that has already passed with reason 'expired'", async () => {
    const exit = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* SwapService
        return yield* svc.getQuote({
          tokenIn: "0x0000000000000000000000000000000000000001",
          tokenOut: "0x0000000000000000000000000000000000000002",
          amountIn: "1000000",
          slippageTolerance: 0.005,
          deadline: Date.now() - 1_000,
        })
      }).pipe(Effect.provide(layer), Effect.exit),
    )
    expect(exit._tag).toBe("Failure")
    if (exit._tag !== "Failure") return
    expect(firstReason(exit)._tag).toBe("Fail")
    expect((firstReason(exit).error as SwapQuoteError).reason).toBe("expired")
  })
})
