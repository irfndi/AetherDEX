import { describe, expect, it, vi } from "vitest"

vi.mock("wagmi", () => ({
  useAccount: () => ({ isConnected: false, address: undefined }),
  useDisconnect: () => ({ disconnect: vi.fn() }),
  useSignMessage: () => ({ signMessageAsync: vi.fn() }),
  useWalletClient: () => ({ data: undefined }),
  useWaitForTransactionReceipt: () => ({ isLoading: false, isSuccess: false, data: undefined }),
}))

import { formatAmount, type SwapQuote } from "../../src/lib/swap"
import { isQuoteExpired } from "../../src/routes/swap"

const quote: SwapQuote = {
  poolId: "0x0000000000000000000000000000000000000001",
  tokenIn: "0x1111111111111111111111111111111111111111",
  tokenOut: "0x2222222222222222222222222222222222222222",
  amountIn: "1000000000000000000",
  amountOut: "1500000000000000000",
  minAmountOut: "1490000000000000000",
  priceImpact: 0.001,
  fee: 3000,
  gasEstimate: "150000",
  expiresAt: 1_000,
}

describe("isQuoteExpired", () => {
  it("returns false for a quote still valid", () => {
    expect(isQuoteExpired(quote, 500)).toBe(false)
  })

  it("returns true once the quote has expired", () => {
    expect(isQuoteExpired(quote, 2_000)).toBe(true)
  })

  it("treats the exact expiry instant as expired", () => {
    expect(isQuoteExpired(quote, quote.expiresAt)).toBe(true)
  })
})

describe("formatAmount", () => {
  it("formats a raw bigint with trailing zeros trimmed", () => {
    expect(formatAmount("1500000000000000000", 18)).toBe("1.50")
  })

  it("keeps at least two decimals for whole amounts", () => {
    expect(formatAmount("1000000000000000000", 18)).toBe("1.00")
  })

  it("caps the fraction at six digits", () => {
    expect(formatAmount("123456789012345678", 18)).toBe("0.123456")
  })

  it("handles a zero-decimal token", () => {
    expect(formatAmount("100", 0)).toBe("100")
  })

  it("trims trailing zeros below the cap", () => {
    expect(formatAmount("1234500000000000000", 18)).toBe("1.2345")
  })
})
