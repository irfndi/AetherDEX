import { afterEach, describe, expect, it, vi } from "vitest"
import { submitProtectedRawTransaction } from "../../src/lib/protected-submission"

describe("protected submission", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("rejects non-HTTPS endpoints before signing or broadcasting", async () => {
    await expect(
      submitProtectedRawTransaction({ rpcUrl: "http://public-rpc.example", signedTransaction: "0x1234" }),
    ).rejects.toThrow("HTTPS private RPC URL")
  })

  it("submits a signed transaction through eth_sendRawTransaction", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: `0x${"1".repeat(64)}` }), { status: 200 }),
      )
    vi.stubGlobal("fetch", fetchMock)

    await expect(
      submitProtectedRawTransaction({ rpcUrl: "https://private-rpc.example", signedTransaction: "0x1234" }),
    ).resolves.toBe(`0x${"1".repeat(64)}`)
    expect(fetchMock).toHaveBeenCalledWith(
      "https://private-rpc.example",
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining('"method":"eth_sendRawTransaction"'),
      }),
    )
  })

  it("times out a stalled private RPC with a descriptive error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, init?: RequestInit) => {
        const { promise, reject } = Promise.withResolvers<never>()
        init?.signal?.addEventListener("abort", () =>
          reject(new DOMException("The operation was aborted.", "TimeoutError")),
        )
        return promise
      }),
    )

    await expect(
      submitProtectedRawTransaction({
        rpcUrl: "https://private-rpc.example",
        signedTransaction: "0x1234",
        timeoutMs: 20,
      }),
    ).rejects.toThrow("timed out")
  })

  it("rejects a 200 response with a non-JSON body as an invalid RPC response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("<html>oops</html>", { status: 200 })))

    await expect(
      submitProtectedRawTransaction({ rpcUrl: "https://private-rpc.example", signedTransaction: "0x1234" }),
    ).rejects.toThrow("invalid RPC response")
  })
})
