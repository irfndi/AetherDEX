import { describe, expect, test } from "bun:test"

const helper = `${import.meta.dir}/dev-stage.sh`

const devStage = (user: string): string => {
  const proc = Bun.spawnSync(["sh", helper], {
    env: { ...process.env, USER: user },
    stdout: "pipe",
    stderr: "pipe",
  })
  expect(proc.exitCode).toBe(0)
  return proc.stdout.toString().trim()
}

describe("scripts/dev-stage.sh — dev stage derivation", () => {
  test("lowercases and underscores become dashes (matches Pages project suffix)", () => {
    expect(devStage("irfandi")).toBe("dev-irfandi")
    expect(devStage("Irfandi")).toBe("dev-irfandi")
  })

  test("characters outside [a-z0-9-] are replaced with dashes and trimmed", () => {
    expect(devStage("John.Doe!")).toBe("dev-john-doe")
    expect(devStage("Alice_Bob")).toBe("dev-alice-bob")
  })

  test("truncates to 44 chars and never ends in a dash", () => {
    expect(devStage("a".repeat(60))).toBe(`dev-${"a".repeat(40)}`)
    expect(devStage("a".repeat(44))).toBe(`dev-${"a".repeat(40)}`)
  })

  test("fails loudly when USER is not set", () => {
    const proc = Bun.spawnSync(["sh", helper], {
      env: { ...process.env, USER: "" },
      stdout: "pipe",
      stderr: "pipe",
    })
    expect(proc.exitCode).not.toBe(0)
    expect(proc.stderr.toString()).toContain("USER")
  })
})
