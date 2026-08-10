/**
 * Verification gate — verifyTrigger must fail loudly when TWAP is unavailable
 * instead of returning a successful always-false verdict.
 */

import { Effect, Layer } from "effect"
import { describe, expect, it } from "vitest"
import { mockChainStateReaderLayer } from "../../src/services/chain-state-reader"
import type { PoolChainState, PoolKeyParams } from "../../src/services/quote-engine"
import {
  VerificationError,
  VerificationService,
  VerificationServiceLive,
} from "../../src/services/verification.service"

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

const layer = VerificationServiceLive.pipe(
  Layer.provide(mockChainStateReaderLayer(new Map([["pool-1", state]]), () => "pool-1")),
)

describe("VerificationService.verifyTrigger", () => {
  it("fails with twap_unavailable when TWAP is not wired instead of returning isTriggered:false", async () => {
    const exit = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* VerificationService
        return yield* svc.verifyTrigger({
          poolKey: key,
          twapWindow: 300,
          triggerPriceX18: 2_000_000_000_000_000_000n,
          orderType: "take_profit",
          zeroForOne: true,
        })
      }).pipe(Effect.provide(layer), Effect.exit),
    )
    expect(exit._tag).toBe("Failure")
    if (exit._tag === "Failure") {
      const reason = exit.cause?.reasons?.[0]
      expect(reason?._tag).toBe("Fail")
      if (reason?._tag === "Fail") {
        expect(reason.error).toBeInstanceOf(VerificationError)
        expect((reason.error as VerificationError).reason).toBe("twap_unavailable")
      }
    }
  })
})
