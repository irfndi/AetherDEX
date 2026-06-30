import { SELF } from "cloudflare:test"
import { describe, expect, it } from "vitest"

describe("API smoke test", () => {
  it("health check returns 200", async () => {
    const response = await SELF.fetch("http://localhost/health")
    expect(response.status).toBe(200)
    const body = await response.json<{ status: string; service: string; timestamp: number }>()
    expect(body).toMatchObject({ status: "ok", service: "aetherdex-api" })
  })

  it("ping returns pong", async () => {
    const response = await SELF.fetch("http://localhost/api/v1/ping")
    expect(response.status).toBe(200)
    const body = await response.json<{ pong: boolean }>()
    expect(body).toEqual({ pong: true })
  })

  it("returns 404 for unknown paths", async () => {
    const response = await SELF.fetch("http://localhost/nope")
    expect(response.status).toBe(404)
  })
})
