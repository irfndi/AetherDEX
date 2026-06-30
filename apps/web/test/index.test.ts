import { describe, expect, it } from "vitest"

describe("frontend smoke test", () => {
  it("imports work", () => {
    expect(typeof describe).toBe("function")
    expect(typeof it).toBe("function")
    expect(typeof expect).toBe("function")
  })

  it("environment is happy-dom", () => {
    expect(typeof window).toBe("object")
    expect(typeof document).toBe("object")
  })
})
