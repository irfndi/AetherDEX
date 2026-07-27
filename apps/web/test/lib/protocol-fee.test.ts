import { afterEach, describe, expect, it, vi } from "vitest"
import { API_URL } from "../../src/lib/api"
import {
  computeProtocolFee,
  computeProtocolFeeDisplay,
  DEPOSIT_ESTIMATE_MODES,
  fetchDepositEstimate,
  formatProtocolFeeAmount,
  formatProtocolFeeUsd,
  PROTOCOL_FEE_BPS,
  PROTOCOL_FEE_CHARGED_ON,
  PROTOCOL_FEE_PERCENT,
  PROTOCOL_FEE_PERCENT_LABEL,
} from "../../src/lib/protocol-fee"

afterEach(() => {
  vi.mocked(globalThis.fetch).mockReset()
})

const respondJson = (body: unknown, status = 200) =>
  vi.mocked(globalThis.fetch).mockResolvedValueOnce(
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }),
  )

describe("protocol fee constants", () => {
  it("match the immutable AetherRouter entry fee (10 bps = 0.1%)", () => {
    expect(PROTOCOL_FEE_BPS).toBe(10)
    expect(PROTOCOL_FEE_PERCENT).toBe(0.1)
    expect(PROTOCOL_FEE_PERCENT_LABEL).toBe("0.1%")
    expect(PROTOCOL_FEE_CHARGED_ON).toBe("liquidity_deposits")
    expect(DEPOSIT_ESTIMATE_MODES).toEqual(["add_liquidity", "add_liquidity_single_sided"])
  })
})

describe("computeProtocolFee (bigint, on-chain-exact)", () => {
  it("charges 10 bps on the gross amount and returns the net remainder", () => {
    expect(computeProtocolFee(100_000n)).toEqual({ fee: 100n, amountAfterFee: 99_900n })
    // 1 ETH in wei → fee 0.001 ETH, net 0.999 ETH
    expect(computeProtocolFee(10n ** 18n)).toEqual({
      fee: 10n ** 15n,
      amountAfterFee: 10n ** 18n - 10n ** 15n,
    })
  })

  it("floors the fee exactly like the router (sub-bps inputs cost zero)", () => {
    expect(computeProtocolFee(999n)).toEqual({ fee: 0n, amountAfterFee: 999n })
    expect(computeProtocolFee(1_000n)).toEqual({ fee: 1n, amountAfterFee: 999n })
    expect(computeProtocolFee(0n)).toEqual({ fee: 0n, amountAfterFee: 0n })
  })

  it("stays exact far beyond Number.MAX_SAFE_INTEGER", () => {
    const gross = 2n ** 127n - 1n
    const { fee, amountAfterFee } = computeProtocolFee(gross)
    expect(fee).toBe((gross * 10n) / 10_000n)
    expect(fee + amountAfterFee).toBe(gross)
  })

  it("rejects negative amounts", () => {
    expect(() => computeProtocolFee(-1n)).toThrow(RangeError)
  })
})

describe("computeProtocolFeeDisplay (number, display path)", () => {
  it("computes 0.1% of a human-readable decimal amount", () => {
    expect(computeProtocolFeeDisplay(12.5)).toEqual({ fee: 0.0125, amountAfterFee: 12.4875 })
    expect(computeProtocolFeeDisplay(1_000)).toEqual({ fee: 1, amountAfterFee: 999 })
    expect(computeProtocolFeeDisplay(0)).toEqual({ fee: 0, amountAfterFee: 0 })
  })

  it("does not surface binary floating-point dust", () => {
    const { fee, amountAfterFee } = computeProtocolFeeDisplay(0.3)
    expect(fee).toBe(0.0003)
    expect(amountAfterFee).toBe(0.2997)
  })

  it("rejects non-finite and negative amounts", () => {
    expect(() => computeProtocolFeeDisplay(Number.NaN)).toThrow(RangeError)
    expect(() => computeProtocolFeeDisplay(Number.POSITIVE_INFINITY)).toThrow(RangeError)
    expect(() => computeProtocolFeeDisplay(-5)).toThrow(RangeError)
  })
})

describe("formatProtocolFeeAmount", () => {
  it("formats base units as a trimmed decimal string", () => {
    expect(formatProtocolFeeAmount(12_500_000_000_000_000n, 18)).toBe("0.0125")
    expect(formatProtocolFeeAmount(2_000_000_000_000_000_000n, 18)).toBe("2")
    expect(formatProtocolFeeAmount(9_000_000_000_000_000_000n, 18)).toBe("9")
    expect(formatProtocolFeeAmount(2_500_000n, 6)).toBe("2.5")
  })

  it("keeps sub-unit dust intact and renders zero fees as 0", () => {
    expect(formatProtocolFeeAmount(1n, 18)).toBe("0.000000000000000001")
    expect(formatProtocolFeeAmount(0n, 18)).toBe("0")
  })
})

describe("formatProtocolFeeUsd", () => {
  it("matches the compact pool-page formatUsd style", () => {
    expect(formatProtocolFeeUsd(2_500_000)).toBe("$2.50M")
    expect(formatProtocolFeeUsd(1_234.5)).toBe("$1.23K")
    expect(formatProtocolFeeUsd(12.345)).toBe("$12.35")
    expect(formatProtocolFeeUsd(0.5)).toBe("$0.50")
  })

  it("flags sub-cent estimates instead of pretending they are zero", () => {
    expect(formatProtocolFeeUsd(0.004)).toBe("< $0.01")
    expect(formatProtocolFeeUsd(0)).toBe("$0.00")
    expect(formatProtocolFeeUsd(Number.NaN)).toBe("—")
    expect(formatProtocolFeeUsd(-1)).toBe("—")
  })
})

describe("fetchDepositEstimate", () => {
  const token = "0x1111111111111111111111111111111111111111"

  it("posts gross amounts as strings to the API deposit-estimate endpoint", async () => {
    const payload = {
      mode: "add_liquidity_single_sided",
      protocolFee: {
        protocolFeeBps: 10,
        protocolFeePercent: 0.1,
        protocolFeePercentLabel: "0.1%",
        chargedOn: "liquidity_deposits",
        chargedHere: true,
        amounts: [
          {
            token,
            grossAmount: "1000000000000000000",
            protocolFeeAmount: "1000000000000000",
            amountAfterProtocolFee: "999000000000000000",
          },
        ],
      },
    }
    respondJson(payload)

    const result = await fetchDepositEstimate("add_liquidity_single_sided", [
      { token, grossAmount: 10n ** 18n },
    ])

    expect(globalThis.fetch).toHaveBeenCalledWith(
      `${API_URL}/liquidity/deposit-estimate`,
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          mode: "add_liquidity_single_sided",
          amounts: [{ token, grossAmount: "1000000000000000000" }],
        }),
      }),
    )
    expect(result).toEqual(payload)
  })

  it("omits the token key for unnamed amounts", async () => {
    respondJson({
      mode: "add_liquidity",
      protocolFee: { chargedHere: true, amounts: [{ grossAmount: "5", protocolFeeAmount: "0", amountAfterProtocolFee: "5" }] },
    })

    await fetchDepositEstimate("add_liquidity", [{ grossAmount: 5n }])

    expect(JSON.parse(vi.mocked(globalThis.fetch).mock.calls[0]?.[1]?.body as string)).toEqual({
      mode: "add_liquidity",
      amounts: [{ grossAmount: "5" }],
    })
  })

  it("throws with the HTTP status for non-2xx responses", async () => {
    respondJson({ error: "boom" }, 400)
    await expect(fetchDepositEstimate("add_liquidity", [{ grossAmount: 1n }])).rejects.toThrow(
      "Deposit estimate failed: HTTP 400",
    )
  })

  it("rejects malformed payloads instead of trusting the server shape", async () => {
    respondJson({ mode: "nope", protocolFee: { chargedHere: true, amounts: [] } })
    await expect(fetchDepositEstimate("add_liquidity", [{ grossAmount: 1n }])).rejects.toThrow(
      "Deposit estimate response is missing a valid mode",
    )
  })
})
