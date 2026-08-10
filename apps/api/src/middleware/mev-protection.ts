/**
 * Phase-3 API safety — MEV-protection configuration hook for tx-building routes.
 *
 * MEV_PROTECTION_MODE:
 *   - "client"  (default): enforce client-side guards — reject requested
 *     slippage tolerances above MEV_MAX_SLIPPAGE_BPS (sandwich defence).
 *   - "private": route submission through a private transaction relay.
 *     Requires BOTH the relay endpoint (PRIVATE_TX_RELAY_URL) and a relay
 *     signing key (PRIVATE_TX_RELAY_SIGNING_KEY secret). Until both are
 *     configured this mode DEGRADES to "client" with a warning — this
 *     middleware is the wiring point where that relayer will plug in.
 *   - "off":     no enforcement; header still reports the mode.
 *
 * Responses on tx-building routes carry X-MEV-Protection (effective mode),
 * X-MEV-Relay: configured (private mode ONLY when relay capability is
 * confirmed), and X-MEV-High-Value: true when the request's USD notional
 * (readAmountUsd) meets HIGH_VALUE_USD_THRESHOLD.
 */

import type { Context, Next } from "hono"
import type { AuthVariables } from "../auth/middleware"
import { readCircuitBreakerConfig, readMevProtectionConfig, type SafetyEnv } from "../lib/safety-config"

export type MevProtectionMiddleware = (
  c: Context<{ Variables: AuthVariables }>,
  next: Next,
) => Promise<Response | undefined>

type ValueReader = (c: Context<{ Variables: AuthVariables }>) => number | null | Promise<number | null>

export interface MevProtectionOptions {
  /** Requested slippage tolerance in bps, or null when the request carries none. */
  readSlippageBps?: ValueReader
  /** Request USD notional, or null when unavailable. Drives X-MEV-High-Value. */
  readAmountUsd?: ValueReader
}

async function safeRead(
  read: ValueReader | undefined,
  c: Context<{ Variables: AuthVariables }>,
): Promise<number | null> {
  if (!read) return null
  try {
    const value = await read(c)
    return typeof value === "number" && Number.isFinite(value) ? value : null
  } catch {
    return null
  }
}

/**
 * Route-scoped MEV guard. Mount inline on tx-building routes:
 *   router.post("/build", rateLimit(), circuitBreaker(), mevProtection({ ... }), handler)
 */
export function mevProtection(options: MevProtectionOptions = {}): MevProtectionMiddleware {
  return async (c, next) => {
    // c.env is undefined when a sub-router is exercised directly (app.request without env).
    const env = (c.env ?? {}) as SafetyEnv
    const config = readMevProtectionConfig(env)
    let effectiveMode = config.mode

    if (effectiveMode === "private") {
      // A relay URL alone proves nothing — without a signing key the relay
      // cannot submit on the user's behalf, so claiming "private" would be a
      // false security assurance (transactions would still broadcast publicly).
      const signingKey = env.PRIVATE_TX_RELAY_SIGNING_KEY?.trim() ?? ""
      if (config.privateRelayUrl === null || signingKey === "") {
        console.warn(
          "[mev] MEV_PROTECTION_MODE=private requires PRIVATE_TX_RELAY_URL and PRIVATE_TX_RELAY_SIGNING_KEY — " +
            "degrading to client-side protection (no relay capability configured)",
        )
        effectiveMode = "client"
      }
    }

    if (effectiveMode !== "off") {
      const slippageBps = await safeRead(options.readSlippageBps, c)
      if (slippageBps !== null && slippageBps > config.maxSlippageBps) {
        return c.json({ error: `Slippage tolerance exceeds the ${config.maxSlippageBps} bps MEV protection cap` }, 400)
      }
    }

    await next()

    c.res.headers.set("X-MEV-Protection", effectiveMode)
    if (effectiveMode === "private") {
      c.res.headers.set("X-MEV-Relay", "configured")
    }

    const threshold = readCircuitBreakerConfig(env).highValueUsdThreshold
    if (threshold !== undefined) {
      const amountUsd = await safeRead(options.readAmountUsd, c)
      if (amountUsd !== null && amountUsd >= threshold) {
        c.res.headers.set("X-MEV-High-Value", "true")
      }
    }
    return
  }
}
