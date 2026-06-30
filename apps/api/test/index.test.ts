import { describe, expect, it } from "vitest"

describe("API utilities", () => {
  it("string concat works", () => {
    expect("aetherdex-" + "api").toBe("aetherdex-api")
  })

  it("basic math works", () => {
    expect(2 + 2).toBe(4)
  })
})
