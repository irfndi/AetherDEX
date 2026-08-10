/**
 * Monitoring alert rules — config invariants and severity-union drift guard.
 *
 * Covers:
 * - every ALERT_RULES entry satisfies the config invariants (clawpatch 0793)
 * - AlertSeverity stays derived from ALERT_RULES, so adding a rule with a new
 *   severity cannot silently drift from the type (b8bc)
 */

import { describe, expect, expectTypeOf, it } from "vitest"
import { ALERT_RULES, type AlertSeverity } from "../../src/monitoring/alerts"

describe("ALERT_RULES invariants", () => {
  it("defines at least one rule", () => {
    expect(Object.keys(ALERT_RULES).length).toBeGreaterThan(0)
  })

  it("every rule has a positive numeric threshold and window", () => {
    for (const [key, rule] of Object.entries(ALERT_RULES)) {
      expect(typeof rule.threshold, `rule ${key} threshold`).toBe("number")
      expect(rule.threshold, `rule ${key} threshold`).toBeGreaterThan(0)
      expect(typeof rule.windowMinutes, `rule ${key} windowMinutes`).toBe("number")
      expect(rule.windowMinutes, `rule ${key} windowMinutes`).toBeGreaterThan(0)
    }
  })

  it("every rule uses a known severity and a non-empty message", () => {
    for (const [key, rule] of Object.entries(ALERT_RULES)) {
      expect(["warn", "critical"], `rule ${key} severity`).toContain(rule.severity)
      expect(rule.message.trim().length, `rule ${key} message`).toBeGreaterThan(0)
    }
  })
})

describe("AlertSeverity drift guard", () => {
  it("AlertSeverity is exactly the set of severities used in ALERT_RULES", () => {
    type RuleSeverities = (typeof ALERT_RULES)[keyof typeof ALERT_RULES]["severity"]
    // Compile-time: if ALERT_RULES gains a new severity, this fails typecheck.
    expectTypeOf<RuleSeverities>().toEqualTypeOf<AlertSeverity>()
    // Runtime: every rule's severity is a member of the union.
    const severities = new Set(Object.values(ALERT_RULES).map((rule) => rule.severity))
    for (const severity of severities) {
      expect(["warn", "critical"] as AlertSeverity[]).toContain(severity)
    }
  })
})
