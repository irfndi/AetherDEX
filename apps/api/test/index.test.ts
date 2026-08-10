import { env } from "cloudflare:test"
import { describe, expect, it } from "vitest"
import { app } from "../src/index"

const baseEnv = {
  ...env,
  ENVIRONMENT: "development",
}

describe("API entry point", () => {
  it("reports healthy when all dependency probes pass", async () => {
    const response = await app.request("/health", {}, baseEnv)
    expect(response.status).toBe(200)
    const body = (await response.json()) as { status: string }
    expect(body.status).toBe("ok")
  })

  it("reports degraded (503) when a dependency probe fails", async () => {
    const brokenDb = {
      prepare: () => {
        throw new Error("D1 down")
      },
    } as unknown as D1Database
    const response = await app.request("/health", {}, { ...baseEnv, DB: brokenDb })
    expect(response.status).toBe(503)
    const body = (await response.json()) as { status: string }
    expect(body.status).toBe("degraded")
  })

  it("does not allow localhost origins in production unless configured", async () => {
    const response = await app.request(
      "/api/v1/ping",
      { headers: { Origin: "http://localhost:3000" } },
      { ...baseEnv, ENVIRONMENT: "production" },
    )
    expect(response.headers.get("access-control-allow-origin")).toBeNull()
  })

  it("allows localhost origins in development", async () => {
    const response = await app.request("/api/v1/ping", { headers: { Origin: "http://localhost:3000" } }, baseEnv)
    expect(response.headers.get("access-control-allow-origin")).toBe("http://localhost:3000")
  })

  it("forwards orderbook websocket upgrades with a canonical lower-cased pool id", async () => {
    let capturedPoolId = ""
    const orderBookStub = {
      idFromName: (name: string) => {
        capturedPoolId = name
        return { fetch: async () => new Response("ws-ok") }
      },
      get: () => ({ fetch: async () => new Response("ws-ok") }),
    } as unknown as DurableObjectNamespace
    const response = await app.request(
      "/ws/orderbook/0xABCdef1234567890ABCdef1234567890ABCdef1234567890ABCdef1234567890",
      {},
      { ...baseEnv, ORDER_BOOK: orderBookStub },
    )
    expect(response.status).toBe(200)
    expect(capturedPoolId).toBe("0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890")
  })

  it("rejects an invalid pool id with 400 before touching storage", async () => {
    const response = await app.request("/ws/orderbook/0x123", {}, baseEnv)
    expect(response.status).toBe(400)
  })

  it("returns the 404 JSON shape for unknown routes", async () => {
    const response = await app.request("/nope", {}, baseEnv)
    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({ error: "Not found", path: "/nope" })
  })
})
