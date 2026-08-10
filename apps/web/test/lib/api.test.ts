import { Effect } from "effect"
import { afterEach, describe, expect, it, vi } from "vitest"
import { fetchTokens, listPools } from "../../src/lib/api"

describe("api client", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("listPools rejects with the HTTP status when the server responds non-ok", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("<html>upstream error</html>", { status: 500 })))

    await expect(Effect.runPromise(listPools(50, 0))).rejects.toThrow(/HTTP 500/)
  })

  it("fetchTokens rejects with the HTTP status when the server responds non-ok", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("nope", { status: 503 })))

    await expect(Effect.runPromise(fetchTokens())).rejects.toThrow(/HTTP 503/)
  })
})
