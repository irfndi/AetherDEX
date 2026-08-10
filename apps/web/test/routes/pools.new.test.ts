import { describe, expect, it, vi } from "vitest"

vi.mock("wagmi", () => ({
  useAccount: () => ({ isConnected: false }),
}))

import {
  buildPoolCreationTransactionIntent,
  type PoolCreationFormValues,
  validatePoolCreationForm,
} from "../../src/routes/pools.new"

const base: PoolCreationFormValues = {
  token0: "0x1111111111111111111111111111111111111111",
  token1: "0x2222222222222222222222222222222222222222",
  fee: "3000",
  tickSpacing: "60",
  priceInput: { kind: "price", value: "1" },
  deadline: "2035-01-01T00:00:00Z",
}

const NOW = 1_800_000_000 // fixed "now" so deadline checks are deterministic
const DEADLINE_SECONDS = Math.floor(Date.parse("2035-01-01T00:00:00Z") / 1000)

describe("validatePoolCreationForm", () => {
  it("accepts a valid form and produces a transaction request", () => {
    const { errors, request } = validatePoolCreationForm(base, NOW)
    expect(errors).toEqual({})
    expect(request).not.toBeNull()
    expect(request?.fee).toBe(3000)
    expect(request?.tickSpacing).toBe(60)
    expect(request?.deadline).toBe(DEADLINE_SECONDS)
  })

  it("rejects identical token addresses", () => {
    const { errors, request } = validatePoolCreationForm({ ...base, token1: base.token0 }, NOW)
    expect(errors.pair).toBe("Tokens must be distinct.")
    expect(request).toBeNull()
  })

  it("rejects unsorted token addresses", () => {
    const { errors } = validatePoolCreationForm({ ...base, token0: base.token1, token1: base.token0 }, NOW)
    expect(errors.pair).toBe("Token0 must be the lower address.")
  })

  it("rejects an invalid token address", () => {
    const { errors, request } = validatePoolCreationForm({ ...base, token0: "0xzz" }, NOW)
    expect(errors.token0).toBe("Enter a valid 0x address.")
    expect(request).toBeNull()
  })

  it("rejects a fee above MAX_V4_FEE", () => {
    const { errors } = validatePoolCreationForm({ ...base, fee: "1000001" }, NOW)
    expect(errors.fee).toBe("Fee must be at most 1000000.")
  })

  it("rejects a zero or non-numeric fee", () => {
    expect(validatePoolCreationForm({ ...base, fee: "0" }, NOW).errors.fee).toBe("Fee must be a positive integer.")
    expect(validatePoolCreationForm({ ...base, fee: "abc" }, NOW).errors.fee).toBe("Fee must be a positive integer.")
  })

  it("rejects tick spacing above MAX_V4_TICK_SPACING", () => {
    const { errors } = validatePoolCreationForm({ ...base, tickSpacing: "32768" }, NOW)
    expect(errors.tickSpacing).toBe("Tick spacing must be at most 32767.")
  })

  it("rejects a sqrtPriceX96 above uint160", () => {
    const { errors } = validatePoolCreationForm(
      { ...base, priceInput: { kind: "sqrtPriceX96", value: "1461501637330902918203684832716283019655932542976" } },
      NOW,
    )
    expect(errors.priceInput).toBe("sqrtPriceX96 must fit in uint160.")
  })

  it("rejects a non-integer sqrtPriceX96", () => {
    const { errors } = validatePoolCreationForm({ ...base, priceInput: { kind: "sqrtPriceX96", value: "1.5" } }, NOW)
    expect(errors.priceInput).toBe("sqrtPriceX96 must be a positive integer.")
  })

  it("rejects a price too small to encode as sqrtPriceX96", () => {
    const { errors } = validatePoolCreationForm(
      { ...base, priceInput: { kind: "price", value: "0.0000000000000000001" } },
      NOW,
    )
    expect(errors.priceInput).toBe("Initial price is too small to encode as sqrtPriceX96.")
  })

  it("rejects a non-positive price", () => {
    const { errors } = validatePoolCreationForm({ ...base, priceInput: { kind: "price", value: "0" } }, NOW)
    expect(errors.priceInput).toBe("Initial price must be positive.")
  })

  it("rejects a past deadline", () => {
    const { errors, request } = validatePoolCreationForm({ ...base, deadline: "2000-01-01T00:00:00Z" }, NOW)
    expect(errors.deadline).toBe("Deadline must be a future date and time.")
    expect(request).toBeNull()
  })

  it("rejects a deadline equal to now", () => {
    const { errors } = validatePoolCreationForm({ ...base, deadline: new Date(NOW * 1000).toISOString() }, NOW)
    expect(errors.deadline).toBe("Deadline must be a future date and time.")
  })
})

describe("buildPoolCreationTransactionIntent", () => {
  it("encodes a price-kind request as createPoolWithDeadline calldata", () => {
    const { request } = validatePoolCreationForm(base, NOW)
    if (request === null) throw new Error("expected a valid request")
    const intent = buildPoolCreationTransactionIntent(request)
    expect(intent.functionName).toBe("createPoolWithDeadline")
    expect(intent.args).toEqual([
      "0x1111111111111111111111111111111111111111",
      "0x2222222222222222222222222222222222222222",
      3000,
      60,
      79228162514264337593543950336n, // sqrtPriceX96 of price 1 (2**96)
      BigInt(DEADLINE_SECONDS),
    ])
    expect(intent.deadline).toBe(DEADLINE_SECONDS)
  })

  it("passes a sqrtPriceX96-kind initial price through unchanged", () => {
    const { request } = validatePoolCreationForm(
      { ...base, priceInput: { kind: "sqrtPriceX96", value: "79228162514264337593543950336" } },
      NOW,
    )
    if (request === null) throw new Error("expected a valid request")
    const intent = buildPoolCreationTransactionIntent(request)
    expect(intent.args[4]).toBe(79228162514264337593543950336n)
  })
})
