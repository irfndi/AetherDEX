/**
 * Phase-3 circuit breaker — closed/open/half-open behaviour against env.CACHE,
 * using test-scoped keys so the canonical cb:state (swap breaker) stays clean.
 */

import { env } from "cloudflare:test"
import { Hono } from "hono"
import { afterEach, describe, expect, it } from "vitest"
import { type CircuitBreakerOptions, circuitBreaker } from "../src/middleware/circuit-breaker"

const FAILURES_KEY = "cb:test_breaker_failures"
const STATE_KEY = "cb:test_breaker_state"

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

let handlerCalls = 0
let nextStatus: "ok" | "boom" = "boom"

function makeApp(overrides: CircuitBreakerOptions = {}) {
  const app = new Hono()
  app.post(
    "/boom",
    circuitBreaker({
      name: "test",
      failuresKey: FAILURES_KEY,
      stateKey: STATE_KEY,
      failureThreshold: 3,
      cooldownSeconds: 1,
      ...overrides,
    }),
    (c) => {
      handlerCalls += 1
      if (nextStatus === "ok") return c.json({ ok: true })
      return c.json({ error: "boom" }, 500)
    },
  )
  return app
}

const post = (app: Hono) => app.request("/boom", { method: "POST" }, { CACHE: env.CACHE })

async function openCircuit(app: Hono): Promise<void> {
  for (let i = 0; i < 3; i++) {
    expect((await post(app)).status).toBe(500)
  }
}

describe("circuit breaker", () => {
  afterEach(async () => {
    await Promise.all([env.CACHE.delete(FAILURES_KEY), env.CACHE.delete(STATE_KEY)])
    handlerCalls = 0
    nextStatus = "boom"
  })

  it("passes failures through while under the threshold", async () => {
    const app = makeApp()

    expect((await post(app)).status).toBe(500)
    expect((await post(app)).status).toBe(500)
    expect(handlerCalls).toBe(2)
  })

  it("opens after the failure threshold and fast-rejects with 503 + Retry-After", async () => {
    const app = makeApp()
    await openCircuit(app)
    expect(handlerCalls).toBe(3)

    const rawState = await env.CACHE.get(STATE_KEY)
    expect(rawState).not.toBeNull()
    expect((JSON.parse(rawState as string) as { status: string }).status).toBe("open")

    const rejected = await post(app)
    expect(rejected.status).toBe(503)
    expect(rejected.headers.get("retry-after")).toMatch(/^\d+$/)
    expect(await rejected.json()).toEqual({ error: "Service temporarily unavailable (circuit open). Retry later." })
    expect(handlerCalls).toBe(3)
  })

  it("half-open trial success closes the circuit and resets failures", async () => {
    const app = makeApp()
    await openCircuit(app)
    expect((await post(app)).status).toBe(503)

    await sleep(1150)
    nextStatus = "ok"

    const trial = await post(app)
    expect(trial.status).toBe(200)
    expect(handlerCalls).toBe(4)

    expect(await env.CACHE.get(STATE_KEY)).toBeNull()
    expect(await env.CACHE.get(FAILURES_KEY)).toBeNull()

    nextStatus = "boom"
    expect((await post(app)).status).toBe(500)
    expect((await post(app)).status).toBe(500)
    expect(handlerCalls).toBe(6)
  })

  it("half-open trial failure re-opens the circuit immediately", async () => {
    const app = makeApp()
    await openCircuit(app)

    await sleep(1150)
    const trial = await post(app)
    expect(trial.status).toBe(500)
    expect(handlerCalls).toBe(4)

    const rejected = await post(app)
    expect(rejected.status).toBe(503)
    expect(handlerCalls).toBe(4)
  })

  it("counts thrown handler errors and returns the standard 500 shape", async () => {
    const app = new Hono()
    // Mirror the production index.ts error handler so thrown errors surface as the API JSON shape.
    app.onError((err, c) => {
      console.error("API error:", err)
      return c.json({ error: "Internal server error" }, 500)
    })
    app.post(
      "/throws",
      circuitBreaker({
        name: "test",
        failuresKey: FAILURES_KEY,
        stateKey: STATE_KEY,
        failureThreshold: 3,
        cooldownSeconds: 1,
      }),
      () => {
        handlerCalls += 1
        throw new Error("kaboom")
      },
    )
    const postThrows = () => app.request("/throws", { method: "POST" }, { CACHE: env.CACHE })

    const first = await postThrows()
    expect(first.status).toBe(500)
    expect(await first.json()).toEqual({ error: "Internal server error" })

    await postThrows()
    await postThrows()
    expect(handlerCalls).toBe(3)

    expect((await postThrows()).status).toBe(503)
    expect(handlerCalls).toBe(3)
  })

  it("weights high-value request failures to open sooner", async () => {
    const app = makeApp({ isHighValueRequest: () => true, highValueFailureWeight: 2 })

    expect((await post(app)).status).toBe(500)
    expect((await post(app)).status).toBe(500)
    expect(handlerCalls).toBe(2)

    expect((await post(app)).status).toBe(503)
  })

  it("fails open when the CACHE binding is missing", async () => {
    const app = makeApp()

    const first = await app.request("/boom", { method: "POST" }, {})
    const second = await app.request("/boom", { method: "POST" }, {})

    expect(first.status).toBe(500)
    expect(second.status).toBe(500)
    expect(handlerCalls).toBe(2)
  })
})
