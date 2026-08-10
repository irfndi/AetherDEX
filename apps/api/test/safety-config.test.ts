/**
 * API safety configuration (src/lib/safety-config.ts) — unit tests.
 * Regression coverage: PRIVATE_TX_RELAY_URL must be https-only (cleartext
 * private submission is never allowed, mirroring keeper-signer.parseRelayUrl),
 * and the mode/slippage knobs keep their defensive safe defaults.
 */

import { describe, expect, it } from "vitest"
import { readMevProtectionConfig } from "../src/lib/safety-config"

describe("readMevProtectionConfig", () => {
  it("accepts only https private relay URLs — never cleartext http or bare schemes", () => {
    expect(readMevProtectionConfig({ PRIVATE_TX_RELAY_URL: "https://relay.example/submit" }).privateRelayUrl).toBe(
      "https://relay.example/submit",
    )
    expect(readMevProtectionConfig({ PRIVATE_TX_RELAY_URL: "http://relay.example" }).privateRelayUrl).toBeNull()
    expect(readMevProtectionConfig({ PRIVATE_TX_RELAY_URL: "http://" }).privateRelayUrl).toBeNull()
    expect(readMevProtectionConfig({ PRIVATE_TX_RELAY_URL: "ws://relay.example" }).privateRelayUrl).toBeNull()
    expect(readMevProtectionConfig({ PRIVATE_TX_RELAY_URL: "not a url" }).privateRelayUrl).toBeNull()
    expect(readMevProtectionConfig({ PRIVATE_TX_RELAY_URL: "   " }).privateRelayUrl).toBeNull()
    expect(readMevProtectionConfig({}).privateRelayUrl).toBeNull()
  })

  it("parses the mode defensively with a safe default", () => {
    expect(readMevProtectionConfig({}).mode).toBe("client")
    expect(readMevProtectionConfig({ MEV_PROTECTION_MODE: "off" }).mode).toBe("off")
    expect(readMevProtectionConfig({ MEV_PROTECTION_MODE: "private" }).mode).toBe("private")
    expect(readMevProtectionConfig({ MEV_PROTECTION_MODE: "garbage" }).mode).toBe("client")
  })

  it("parses the slippage ceiling defensively with a safe default", () => {
    expect(readMevProtectionConfig({ MEV_MAX_SLIPPAGE_BPS: "250" }).maxSlippageBps).toBe(250)
    expect(readMevProtectionConfig({ MEV_MAX_SLIPPAGE_BPS: "-5" }).maxSlippageBps).toBe(500)
    expect(readMevProtectionConfig({ MEV_MAX_SLIPPAGE_BPS: "abc" }).maxSlippageBps).toBe(500)
  })
})
