import { describe, expect, it } from "vitest"
import {
  buildPoolCreationTransactionIntent,
  type PoolCreationFormValues,
  validatePoolCreationForm,
} from "../../src/routes/pools.new"

const token0 = "0x1111111111111111111111111111111111111111"
const token1 = "0x2222222222222222222222222222222222222222"
const validValues: PoolCreationFormValues = {
  token0,
  token1,
  fee: "3000",
  tickSpacing: "60",
  priceInput: { kind: "price", value: "1.25" },
  deadline: "2030-01-01T12:00",
}

describe("pool creation validation", () => {
  it("returns a normalized typed request for a valid sorted pair", () => {
    const result = validatePoolCreationForm(validValues, Math.floor(Date.parse("2029-01-01") / 1000))

    expect(result.errors).toEqual({})
    expect(result.request).toMatchObject({
      token0,
      token1,
      fee: 3000,
      tickSpacing: 60,
    })
    expect(result.request?.deadline).toBeGreaterThan(Math.floor(Date.parse("2029-01-01") / 1000))
  })

  it("rejects identical and unsorted token addresses", () => {
    expect(validatePoolCreationForm({ ...validValues, token1: token0 }, Date.now()).errors.pair).toBe(
      "Tokens must be distinct.",
    )
    expect(validatePoolCreationForm({ ...validValues, token0: token1, token1: token0 }, Date.now()).errors.pair).toBe(
      "Token0 must be the lower address.",
    )
  })

  it("rejects malformed addresses, non-positive prices, and expired deadlines", () => {
    const result = validatePoolCreationForm(
      { ...validValues, token0: "0x123", priceInput: { kind: "price", value: "0" }, deadline: "2020-01-01T00:00" },
      Math.floor(Date.parse("2025-01-01") / 1000),
    )

    expect(result.request).toBeNull()
    expect(result.errors.token0).toBeDefined()
    expect(result.errors.priceInput).toBe("Initial price must be positive.")
    expect(result.errors.deadline).toBe("Deadline must be a future date and time.")
  })

  it("requires a positive integer for sqrtPriceX96", () => {
    const result = validatePoolCreationForm({ ...validValues, priceInput: { kind: "sqrtPriceX96", value: "1.5" } })

    expect(result.request).toBeNull()
    expect(result.errors.priceInput).toBe("sqrtPriceX96 must be a positive integer.")
  })
})

describe("pool creation transaction intent", () => {
  it("contains the factory method and no deployment address", () => {
    const result = validatePoolCreationForm(validValues, Math.floor(Date.parse("2029-01-01") / 1000))
    if (!result.request) throw new Error("expected valid request")

    const intent = buildPoolCreationTransactionIntent(result.request)
    expect(intent.functionName).toBe("createPool")
    expect(intent.args.slice(0, 4)).toEqual([token0, token1, 3000, 60])
    expect(intent.args[4]).toBeGreaterThan(0n)
    expect("address" in intent).toBe(false)
  })
})
