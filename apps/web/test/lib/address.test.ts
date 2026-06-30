import { describe, expect, it } from "vitest"
import { isValidAddress, normalizeAddress, shortenAddress } from "../../src/lib/address"

describe("isValidAddress", () => {
  it("returns true for valid checksummed address", () => {
    expect(isValidAddress("0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48")).toBe(true)
  })

  it("returns true for valid lowercase address", () => {
    expect(isValidAddress("0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48")).toBe(true)
  })

  it("returns false for empty string", () => {
    expect(isValidAddress("")).toBe(false)
  })

  it("returns false for random text", () => {
    expect(isValidAddress("not-an-address")).toBe(false)
  })

  it("returns false for short address", () => {
    expect(isValidAddress("0x1234")).toBe(false)
  })
})

describe("shortenAddress", () => {
  it("shortens a full address with default chars", () => {
    expect(shortenAddress("0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48")).toBe("0xA0b8...eB48")
  })

  it("shortens with custom chars", () => {
    expect(shortenAddress("0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", 6)).toBe("0xA0b869...06eB48")
  })

  it("returns empty string for empty input", () => {
    expect(shortenAddress("")).toBe("")
  })

  it("returns original if too short", () => {
    expect(shortenAddress("0x1234")).toBe("0x1234")
  })
})

describe("normalizeAddress", () => {
  it("returns checksummed address", () => {
    const result = normalizeAddress("0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48")
    expect(result).toBe("0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48")
  })

  it("returns original for invalid address", () => {
    expect(normalizeAddress("not-an-address")).toBe("not-an-address")
  })

  it("returns empty string as-is", () => {
    expect(normalizeAddress("")).toBe("")
  })
})
