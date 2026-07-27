/**
 * Phase-3 MEV-protection middleware — slippage cap enforcement, private-relay
 * degrade behaviour, and response metadata headers.
 */

import { env } from "cloudflare:test"
import { Hono } from "hono"
import { describe, expect, it } from "vitest"
import { type MevProtectionOptions, mevProtection } from "../src/middleware/mev-protection"

let handled = 0

function makeApp(options: MevProtectionOptions = {}) {
  const app = new Hono()
  app.post("/build", mevProtection(options), (c) => {
    handled += 1
    return c.json({ ok: true })
  })
  return app
}

const readSlippageBps: NonNullable<MevProtectionOptions["readSlippageBps"]> = (c) =>
  c.req
    .json<{ slippage?: number }>()
    .catch(() => null)
    .then((body) =>
      body && typeof body.slippage === "number" && Number.isFinite(body.slippage)
        ? Math.round(Math.abs(body.slippage) * 10_000)
        : null,
    )

const readAmountUsd: NonNullable<MevProtectionOptions["readAmountUsd"]> = (c) =>
  c.req
    .json<{ usd?: number }>()
    .catch(() => null)
    .then((body) => (body && typeof body.usd === "number" && Number.isFinite(body.usd) ? body.usd : null))

const post = (app: Hono, body: unknown, envVars: Record<string, string> = {}) =>
  app.request(
    "/build",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    },
    { CACHE: env.CACHE, ...envVars },
  )

describe("mevProtection", () => {
  it("defaults to client-side protection and reports it via header", async () => {
    handled = 0
    const res = await post(makeApp(), { slippage: 0.005 })

    expect(res.status).toBe(200)
    expect(res.headers.get("x-mev-protection")).toBe("client")
    expect(handled).toBe(1)
  })

  it("rejects slippage above the default 500 bps cap", async () => {
    handled = 0
    const res = await post(makeApp({ readSlippageBps }), { slippage: 0.06 })

    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: "Slippage tolerance exceeds the 500 bps MEV protection cap" })
    expect(handled).toBe(0)
  })

  it("honours a custom MEV_MAX_SLIPPAGE_BPS ceiling", async () => {
    const res = await post(makeApp({ readSlippageBps }), { slippage: 0.06 }, { MEV_MAX_SLIPPAGE_BPS: "1000" })

    expect(res.status).toBe(200)
  })

  it("degrades private mode to client when no relay URL is configured", async () => {
    const res = await post(makeApp(), {}, { MEV_PROTECTION_MODE: "private", PRIVATE_TX_RELAY_URL: "" })

    expect(res.status).toBe(200)
    expect(res.headers.get("x-mev-protection")).toBe("client")
    expect(res.headers.get("x-mev-relay")).toBeNull()
  })

  it("reports a configured private relay", async () => {
    const res = await post(
      makeApp(),
      {},
      { MEV_PROTECTION_MODE: "private", PRIVATE_TX_RELAY_URL: "https://relay.example/submit" },
    )

    expect(res.status).toBe(200)
    expect(res.headers.get("x-mev-protection")).toBe("private")
    expect(res.headers.get("x-mev-relay")).toBe("configured")
  })

  it("skips slippage enforcement when protection is off", async () => {
    const res = await post(makeApp({ readSlippageBps }), { slippage: 0.2 }, { MEV_PROTECTION_MODE: "off" })

    expect(res.status).toBe(200)
    expect(res.headers.get("x-mev-protection")).toBe("off")
  })

  it("flags high-value requests at or above HIGH_VALUE_USD_THRESHOLD", async () => {
    const app = makeApp({ readAmountUsd })
    const envVars = { HIGH_VALUE_USD_THRESHOLD: "1000" }

    const big = await post(app, { usd: 5000 }, envVars)
    expect(big.headers.get("x-mev-high-value")).toBe("true")

    const small = await post(app, { usd: 500 }, envVars)
    expect(small.headers.get("x-mev-high-value")).toBeNull()
  })

  it("passes through safely when the request body is not valid JSON", async () => {
    const res = await post(makeApp({ readSlippageBps }), "not-json")

    expect(res.status).toBe(200)
  })
})
