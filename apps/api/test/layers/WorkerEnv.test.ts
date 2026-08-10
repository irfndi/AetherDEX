/**
 * WorkerEnv layer — tag identity and layer factory round-trip.
 *
 * Covers:
 * - the WorkerEnv tag exposes the expected service key (clawpatch 7423)
 * - makeWorkerEnvLayer provides the exact env instance back (7423)
 * - the tag is built on Context.Service, which IS the current service-key API
 *   in the pinned effect 4.0.0-beta.100 (Context.Tag is not exported by that
 *   version) — importing this module and providing the layer is the regression
 *   guard for d4cf
 */

import { Effect } from "effect"
import { describe, expect, it } from "vitest"
import { makeWorkerEnvLayer, WorkerEnv } from "../../src/layers/WorkerEnv"

const makeEnv = (): WorkerEnv => ({
  DB: {} as D1Database,
  CACHE: {} as KVNamespace,
  STORAGE: {} as R2Bucket,
  ORDER_BOOK: {} as DurableObjectNamespace,
  WEBSOCKET_HUB: {} as DurableObjectNamespace,
  CHAIN_ID: "11155111",
  ENVIRONMENT: "test",
})

describe("WorkerEnv tag", () => {
  it("exposes the canonical service key", () => {
    expect(WorkerEnv.key).toBe("@aetherdex/WorkerEnv")
  })

  it("makeWorkerEnvLayer provides the exact env instance", async () => {
    const env = makeEnv()
    const result = await Effect.runPromise(Effect.provide(Effect.service(WorkerEnv), makeWorkerEnvLayer(env)))
    expect(result).toBe(env)
  })

  it("provides a different env instance when given one", async () => {
    const first = makeEnv()
    const second = makeEnv()
    const result = await Effect.runPromise(Effect.provide(Effect.service(WorkerEnv), makeWorkerEnvLayer(second)))
    expect(result).toBe(second)
    expect(result).not.toBe(first)
  })
})
