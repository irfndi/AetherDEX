import { describe, expect, it } from "vitest"
import pkg from "../package.json"

const scripts = (pkg as { scripts: Record<string, string> }).scripts

describe("package scripts", () => {
  it("keeps format and lint on the biome check command family", () => {
    for (const script of ["lint", "lint:fix", "format", "format:check"]) {
      expect(scripts[script]).toMatch(/^biome check/)
    }
  })

  it("scopes lint and format to the package root so configs and e2e are covered", () => {
    for (const script of ["lint", "lint:fix", "format", "format:check"]) {
      expect(scripts[script]).toMatch(/biome check( --write)? \.$/)
    }
  })
})
