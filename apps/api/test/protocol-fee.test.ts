import { describe, expect, it } from "vitest"
import {
  computeProtocolFee,
  PROTOCOL_FEE_BPS,
  PROTOCOL_FEE_CHARGED_ON,
  PROTOCOL_FEE_PERCENT,
  PROTOCOL_FEE_PERCENT_LABEL,
  protocolFeeBreakdown,
  ZERO_PROTOCOL_FEE_BREAKDOWN,
} from "../src/lib/protocol-fee"
import { liquidity } from "../src/routes/liquidity"

const postEstimate = (body: unknown) =>
  liquidity.request("/deposit-estimate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  })

describe("computeProtocolFee — bigint path (mirrors AetherRouter._chargeEntryFee)", () => {
  it("charges exactly 10 bps on the gross input", () => {
    expect(computeProtocolFee(1_000_000n)).toEqual({ fee: 1_000n, amountAfterFee: 999_000n })
    expect(computeProtocolFee(10_000n)).toEqual({ fee: 10n, amountAfterFee: 9_990n })
  })

  it("floors sub-basis-point dust to zero like the on-chain integer division", () => {
    expect(computeProtocolFee(999n)).toEqual({ fee: 0n, amountAfterFee: 999n })
    expect(computeProtocolFee(1_000n)).toEqual({ fee: 1n, amountAfterFee: 999n })
    expect(computeProtocolFee(1_999n)).toEqual({ fee: 1n, amountAfterFee: 1_998n })
  })

  it("returns zero fee for a zero amount", () => {
    expect(computeProtocolFee(0n)).toEqual({ fee: 0n, amountAfterFee: 0n })
  })

  it("handles treasury-scale uint128 values without precision loss", () => {
    const gross = 2n ** 127n
    const { fee, amountAfterFee } = computeProtocolFee(gross)
    expect(fee).toBe((gross * 10n) / 10_000n)
    expect(fee + amountAfterFee).toBe(gross)
  })

  it("rejects negative amounts", () => {
    expect(() => computeProtocolFee(-1n)).toThrow(RangeError)
  })
})

describe("computeProtocolFee — number path (display only)", () => {
  it("matches the bigint math for display-scale integers", () => {
    expect(computeProtocolFee(1_000_000)).toEqual({ fee: 1_000, amountAfterFee: 999_000 })
  })

  it("floors fractional fees", () => {
    expect(computeProtocolFee(12_345)).toEqual({ fee: 12, amountAfterFee: 12_333 })
  })

  it("rejects non-finite and negative amounts", () => {
    expect(() => computeProtocolFee(Number.NaN)).toThrow(RangeError)
    expect(() => computeProtocolFee(Number.POSITIVE_INFINITY)).toThrow(RangeError)
    expect(() => computeProtocolFee(-5)).toThrow(RangeError)
  })
})

describe("protocolFeeBreakdown", () => {
  it("returns the frozen zero-fee breakdown for fee-free operations", () => {
    expect(protocolFeeBreakdown(false)).toBe(ZERO_PROTOCOL_FEE_BREAKDOWN)
    expect(ZERO_PROTOCOL_FEE_BREAKDOWN).toEqual({
      protocolFeeBps: 10,
      protocolFeePercent: 0.1,
      protocolFeePercentLabel: "0.1%",
      chargedOn: "liquidity_deposits",
      chargedHere: false,
      amounts: [],
    })
  })

  it("exposes the immutable fee-rate constants", () => {
    expect(PROTOCOL_FEE_BPS).toBe(10)
    expect(PROTOCOL_FEE_PERCENT).toBe(0.1)
    expect(PROTOCOL_FEE_PERCENT_LABEL).toBe("0.1%")
    expect(PROTOCOL_FEE_CHARGED_ON).toBe("liquidity_deposits")
  })

  it("builds per-token lines for charged deposits", () => {
    const breakdown = protocolFeeBreakdown(true, [
      { token: "0xA000000000000000000000000000000000000001", grossAmount: 1_000_000n },
      { grossAmount: 999n },
    ])
    expect(breakdown).toEqual({
      protocolFeeBps: 10,
      protocolFeePercent: 0.1,
      protocolFeePercentLabel: "0.1%",
      chargedOn: "liquidity_deposits",
      chargedHere: true,
      amounts: [
        {
          token: "0xA000000000000000000000000000000000000001",
          grossAmount: "1000000",
          protocolFeeAmount: "1000",
          amountAfterProtocolFee: "999000",
        },
        { token: null, grossAmount: "999", protocolFeeAmount: "0", amountAfterProtocolFee: "999" },
      ],
    })
  })

  it("treats missing inputs as an empty breakdown when charged", () => {
    expect(protocolFeeBreakdown(true).amounts).toEqual([])
    expect(protocolFeeBreakdown(true).chargedHere).toBe(true)
  })
})

describe("POST /api/v1/liquidity/deposit-estimate", () => {
  it("returns the per-token fee breakdown for a dual deposit", async () => {
    const response = await postEstimate({
      mode: "add_liquidity",
      amounts: [
        { token: "0xA000000000000000000000000000000000000001", grossAmount: "1000000" },
        { token: "0xB000000000000000000000000000000000000001", grossAmount: "999" },
      ],
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      mode: "add_liquidity",
      protocolFee: {
        protocolFeeBps: 10,
        protocolFeePercent: 0.1,
        protocolFeePercentLabel: "0.1%",
        chargedOn: "liquidity_deposits",
        chargedHere: true,
        amounts: [
          {
            token: "0xA000000000000000000000000000000000000001",
            grossAmount: "1000000",
            protocolFeeAmount: "1000",
            amountAfterProtocolFee: "999000",
          },
          {
            token: "0xB000000000000000000000000000000000000001",
            grossAmount: "999",
            protocolFeeAmount: "0",
            amountAfterProtocolFee: "999",
          },
        ],
      },
    })
  })

  it("defaults to add_liquidity mode and accepts token-less inputs", async () => {
    const response = await postEstimate({ amounts: [{ grossAmount: "10000" }] })

    expect(response.status).toBe(200)
    const json = (await response.json()) as { mode: string; protocolFee: { chargedHere: boolean } }
    expect(json.mode).toBe("add_liquidity")
    expect(json.protocolFee.chargedHere).toBe(true)
  })

  it("accepts a single-sided zap with exactly one input", async () => {
    const response = await postEstimate({
      mode: "add_liquidity_single_sided",
      amounts: [{ token: "0xA000000000000000000000000000000000000001", grossAmount: "500000" }],
    })

    expect(response.status).toBe(200)
    const json = (await response.json()) as { mode: string; protocolFee: { amounts: unknown[] } }
    expect(json.mode).toBe("add_liquidity_single_sided")
    expect(json.protocolFee.amounts).toHaveLength(1)
  })

  it("rejects a missing or malformed body", async () => {
    expect((await postEstimate("{not-json")).status).toBe(400)
    const missing = await postEstimate({})
    expect(missing.status).toBe(400)
    expect(await missing.json()).toEqual({ error: "amounts must be an array of { token?, grossAmount } entries" })
  })

  it("rejects unknown deposit modes", async () => {
    const response = await postEstimate({ mode: "add_liquidity_v2", amounts: [{ grossAmount: "1" }] })
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({
      error: "mode must be one of: add_liquidity, add_liquidity_single_sided",
    })
  })

  it("rejects empty or oversized amount lists", async () => {
    expect((await postEstimate({ amounts: [] })).status).toBe(400)

    const tooMany = Array.from({ length: 9 }, (_, i) => ({ grossAmount: String(i + 1) }))
    const response = await postEstimate({ amounts: tooMany })
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: "amounts must contain 1 to 8 entries" })
  })

  it("rejects multi-input single-sided zaps", async () => {
    const response = await postEstimate({
      mode: "add_liquidity_single_sided",
      amounts: [{ grossAmount: "100" }, { grossAmount: "200" }],
    })
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({
      error: "add_liquidity_single_sided deposits take exactly one input amount",
    })
  })

  it("rejects non-uint, zero, and out-of-range amounts", async () => {
    expect((await postEstimate({ amounts: [{ grossAmount: "12.5" }] })).status).toBe(400)
    expect((await postEstimate({ amounts: [{ grossAmount: "-1" }] })).status).toBe(400)
    expect((await postEstimate({ amounts: [{ grossAmount: 1000 }] })).status).toBe(400)

    const zero = await postEstimate({ amounts: [{ grossAmount: "0" }] })
    expect(zero.status).toBe(400)
    expect(await zero.json()).toEqual({ error: "grossAmount must be positive" })

    const overflow = await postEstimate({ amounts: [{ grossAmount: "1e999" }] })
    expect(overflow.status).toBe(400)
    expect(await overflow.json()).toEqual({ error: "grossAmount must be a non-negative integer string" })
  })

  it("rejects malformed entries and token addresses", async () => {
    expect((await postEstimate({ amounts: ["not-an-entry"] })).status).toBe(400)

    const badToken = await postEstimate({
      amounts: [{ token: "not-an-address", grossAmount: "1000" }],
    })
    expect(badToken.status).toBe(400)
    expect(await badToken.json()).toEqual({
      error: "token must be a valid 0x-prefixed address when provided",
    })
  })
})
