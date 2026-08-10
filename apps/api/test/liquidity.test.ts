import { describe, expect, it } from "vitest"
import { liquidity } from "../src/routes/liquidity"

const UINT256_MAX = "115792089237316195423570985008687907853269984665640564039457584007913129639935" // 2^256 - 1

const post = (body: unknown) =>
  liquidity.request("/deposit-estimate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })

describe("POST /api/v1/liquidity/deposit-estimate", () => {
  it("rejects a non-JSON or non-object body", async () => {
    const noBody = await liquidity.request("/deposit-estimate", { method: "POST" })
    expect(noBody.status).toBe(400)

    const arrayBody = await liquidity.request("/deposit-estimate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify([]),
    })
    expect(arrayBody.status).toBe(400)
  })

  it("rejects an unknown mode", async () => {
    const response = await post({ mode: "remove_liquidity", amounts: [{ grossAmount: "1000000" }] })
    expect(response.status).toBe(400)
  })

  it("computes the 10 bps entry fee on gross amounts for add_liquidity", async () => {
    const response = await post({
      mode: "add_liquidity",
      amounts: [{ token: "0xA000000000000000000000000000000000000001", grossAmount: "1000000" }],
    })
    expect(response.status).toBe(200)
    const body = (await response.json()) as {
      mode: string
      protocolFee: {
        chargedHere: boolean
        amounts: Array<{
          token: string | null
          grossAmount: string
          protocolFeeAmount: string
          amountAfterProtocolFee: string
        }>
      }
    }
    expect(body.mode).toBe("add_liquidity")
    expect(body.protocolFee.chargedHere).toBe(true)
    expect(body.protocolFee.amounts).toEqual([
      {
        token: "0xA000000000000000000000000000000000000001",
        grossAmount: "1000000",
        protocolFeeAmount: "1000",
        amountAfterProtocolFee: "999000",
      },
    ])
  })

  it("accepts multiple inputs and the unnamed-token form", async () => {
    const response = await post({
      mode: "add_liquidity",
      amounts: [{ grossAmount: "1000000" }, { grossAmount: "250" }],
    })
    expect(response.status).toBe(200)
    const body = (await response.json()) as {
      protocolFee: { amounts: Array<{ token: string | null; amountAfterProtocolFee: string }> }
    }
    expect(body.protocolFee.amounts).toEqual([
      { token: null, grossAmount: "1000000", protocolFeeAmount: "1000", amountAfterProtocolFee: "999000" },
      { token: null, grossAmount: "250", protocolFeeAmount: "0", amountAfterProtocolFee: "250" },
    ])
  })

  it("requires exactly one input for add_liquidity_single_sided", async () => {
    const ok = await post({ mode: "add_liquidity_single_sided", amounts: [{ grossAmount: "1000000" }] })
    expect(ok.status).toBe(200)

    const tooMany = await post({
      mode: "add_liquidity_single_sided",
      amounts: [{ grossAmount: "1" }, { grossAmount: "2" }],
    })
    expect(tooMany.status).toBe(400)
  })

  it("rejects empty or oversized amounts arrays", async () => {
    const empty = await post({ mode: "add_liquidity", amounts: [] })
    expect(empty.status).toBe(400)

    const nine = await post({ mode: "add_liquidity", amounts: Array.from({ length: 9 }, () => ({ grossAmount: "1" })) })
    expect(nine.status).toBe(400)
  })

  it("rejects malformed grossAmount values", async () => {
    for (const grossAmount of ["abc", "1.5", "0", "-1"]) {
      const response = await post({ mode: "add_liquidity", amounts: [{ grossAmount }] })
      expect(response.status).toBe(400)
    }
  })

  it("rejects grossAmount strings beyond uint256 digits before parsing (CPU-amplification guard)", async () => {
    const response = await post({ mode: "add_liquidity", amounts: [{ grossAmount: "9".repeat(79) }] })
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: "grossAmount must not exceed uint256 (max 78 digits)" })
  })

  it("rejects 78-digit values above the uint256 maximum", async () => {
    // 78 nines ≈ 9.99e77 > 2^256 - 1 ≈ 1.157e77 — the digit cap alone must not admit it.
    const response = await post({ mode: "add_liquidity", amounts: [{ grossAmount: "9".repeat(78) }] })
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: "grossAmount must not exceed uint256" })
  })

  it("accepts the exact uint256 maximum", async () => {
    const response = await post({ mode: "add_liquidity", amounts: [{ grossAmount: UINT256_MAX }] })
    expect(response.status).toBe(200)
  })

  it("rejects malformed token addresses", async () => {
    const response = await post({ mode: "add_liquidity", amounts: [{ token: "0x123", grossAmount: "1" }] })
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: "token must be a valid 0x-prefixed address when provided" })
  })
})
