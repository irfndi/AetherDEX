/**
 * Phase-3 rate limiter — unit tests (Hono app.request + env.CACHE from the
 * workers test pool) and a SELF integration pass proving the limiter is
 * scoped to mutations and leaves public reads untouched.
 */

import { env, SELF } from "cloudflare:test"
import { Hono } from "hono"
import { afterEach, describe, expect, it } from "vitest"
import { type AuthVariables, authMiddleware } from "../src/auth/middleware"
import { rateLimit } from "../src/middleware/rate-limit"

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

async function clearRateLimitKeys(): Promise<void> {
  const listed = await env.CACHE.list({ prefix: "rl:" })
  await Promise.all(listed.keys.map((key) => env.CACHE.delete(key.name)))
}

function makeApp(envVars: Record<string, string> = {}) {
  const app = new Hono<{ Variables: AuthVariables }>()
  app.use("*", authMiddleware)
  app.post("/hit", rateLimit(), (c) => c.json({ ok: true }))
  // CHAIN_ID is required for authMiddleware to accept a session (sessions are chain-scoped).
  const testEnv = { CACHE: env.CACHE, CHAIN_ID: "11155111", ...envVars }
  return { app, testEnv }
}

const post = (app: Hono<{ Variables: AuthVariables }>, testEnv: unknown, headers: Record<string, string> = {}) =>
  app.request("/hit", { method: "POST", headers }, testEnv)

describe("rate limiter (KV fixed window)", () => {
  afterEach(clearRateLimitKeys)

  it("allows traffic under the limit and reports limit/remaining headers", async () => {
    const { app, testEnv } = makeApp({ RATE_LIMIT_MAX: "3" })

    const first = await post(app, testEnv)

    expect(first.status).toBe(200)
    expect(first.headers.get("x-ratelimit-limit")).toBe("3")
    expect(first.headers.get("x-ratelimit-remaining")).toBe("2")
  })

  it("returns 429 with Retry-After and the standard error shape once exceeded", async () => {
    const { app, testEnv } = makeApp({ RATE_LIMIT_MAX: "2" })

    expect((await post(app, testEnv)).status).toBe(200)
    expect((await post(app, testEnv)).status).toBe(200)

    const blocked = await post(app, testEnv)
    expect(blocked.status).toBe(429)
    expect(await blocked.json()).toEqual({ error: "Rate limit exceeded. Try again later." })
    expect(blocked.headers.get("retry-after")).toMatch(/^\d+$/)
    expect(blocked.headers.get("x-ratelimit-remaining")).toBe("0")
  })

  it("resets the window after it expires", async () => {
    const { app, testEnv } = makeApp({ RATE_LIMIT_MAX: "1", RATE_LIMIT_WINDOW_SECONDS: "1" })

    expect((await post(app, testEnv)).status).toBe(200)
    expect((await post(app, testEnv)).status).toBe(429)

    await sleep(1150)

    expect((await post(app, testEnv)).status).toBe(200)
  })

  it("buckets callers per client IP (cf-connecting-ip, then x-forwarded-for first hop)", async () => {
    const { app, testEnv } = makeApp({ RATE_LIMIT_MAX: "1" })

    expect((await post(app, testEnv, { "cf-connecting-ip": "203.0.113.7" })).status).toBe(200)
    expect((await post(app, testEnv, { "cf-connecting-ip": "203.0.113.7" })).status).toBe(429)

    const forwarded = await post(app, testEnv, { "x-forwarded-for": "198.51.100.9, 10.0.0.1" })
    expect(forwarded.status).toBe(200)

    expect(await env.CACHE.get("rl:ip:203.0.113.7")).not.toBeNull()
    expect(await env.CACHE.get("rl:ip:198.51.100.9")).not.toBeNull()
  })

  it("prefers the authenticated wallet address over IP when a session exists", async () => {
    const wallet = "0x1111111111111111111111111111111111111111"
    await env.CACHE.put(
      "session:rate-limit-wallet-test",
      JSON.stringify({
        userAddress: wallet,
        issuedAt: Date.now(),
        expiresAt: Date.now() + 60_000,
        chainId: 11155111,
      }),
    )

    const { app, testEnv } = makeApp({ RATE_LIMIT_MAX: "1" })
    const headers = { Authorization: "Bearer rate-limit-wallet-test", "cf-connecting-ip": "203.0.113.9" }

    expect((await post(app, testEnv, headers)).status).toBe(200)
    expect((await post(app, testEnv, headers)).status).toBe(429)

    expect(await env.CACHE.get(`rl:addr:${wallet}`)).not.toBeNull()
    expect(await env.CACHE.get("rl:ip:203.0.113.9")).toBeNull()

    await env.CACHE.delete("session:rate-limit-wallet-test")
  })

  it("fails open when the CACHE binding is missing", async () => {
    const { app } = makeApp({ RATE_LIMIT_MAX: "1" })

    expect((await app.request("/hit", { method: "POST" }, {})).status).toBe(200)
    expect((await app.request("/hit", { method: "POST" }, {})).status).toBe(200)
  })

  it("fails open (no crash) when KV errors", async () => {
    const brokenKv = {
      getWithMetadata: () => Promise.reject(new Error("kv down")),
      put: () => Promise.reject(new Error("kv down")),
    } as unknown as KVNamespace

    const { app } = makeApp({ RATE_LIMIT_MAX: "1" })

    expect((await app.request("/hit", { method: "POST" }, { CACHE: brokenKv })).status).toBe(200)
  })
})

describe("rate limiter integration (SELF)", () => {
  afterEach(clearRateLimitKeys)

  it("guards POST /api/v1/build without touching /health or public GETs", async () => {
    const build = await SELF.fetch("http://fake-host/api/v1/build", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    })

    expect(build.status).toBe(400)
    expect(build.headers.get("x-ratelimit-limit")).toBe("60")
    expect(build.headers.get("x-ratelimit-remaining")).not.toBeNull()
    expect(build.headers.get("x-mev-protection")).toBe("client")

    const health = await SELF.fetch("http://fake-host/health")
    expect(health.status).toBe(200)
    expect(health.headers.get("x-ratelimit-limit")).toBeNull()

    const quote = await SELF.fetch("http://fake-host/api/v1/quote")
    expect(quote.status).toBe(400)
    expect(quote.headers.get("x-ratelimit-limit")).toBeNull()
    expect(quote.headers.get("x-mev-protection")).toBeNull()
  })
})
