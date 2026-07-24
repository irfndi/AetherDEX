import { describe, expect, it, vi } from "vitest"
import { submitProtectedRawTransaction } from "../../src/lib/protected-submission"

describe("protected submission", () => {
  it("rejects non-HTTPS endpoints before signing or broadcasting", async () => {
    await expect(
      submitProtectedRawTransaction({ rpcUrl: "http://public-rpc.example", signedTransaction: "0x1234" }),
    ).rejects.toThrow("HTTPS private RPC URL")
  })

  it("submits a signed transaction through eth_sendRawTransaction", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: `0x${"1".repeat(64)}` }), { status: 200 }),
    )
    vi.stubGlobal("fetch", fetchMock)

    await expect(
      submitProtectedRawTransaction({ rpcUrl: "https://private-rpc.example", signedTransaction: "0x1234" }),
    ).resolves.toBe(`0x${"1".repeat(64)}`)
    expect(fetchMock).toHaveBeenCalledWith(
      "https://private-rpc.example",
      expect.objectContaining({ method: "POST" }),
    )
    vi.unstubAllGlobals()
  })
})
