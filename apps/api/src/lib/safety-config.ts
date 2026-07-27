/**
 * Phase-3 API safety configuration (rate limiting / circuit breaker / MEV).
 *
 * All knobs are plain string env vars (Wrangler vars) with safe defaults; the
 * parsers here are defensive — a malformed value falls back to the default
 * rather than crashing the request. The middlewares in src/middleware consume
 * these readers and fail OPEN when the CACHE KV binding is missing or errors.
 */

/** Env vars the safety middlewares understand. All optional — defaults apply. */
export interface SafetyEnv {
  CACHE?: KVNamespace
  RATE_LIMIT_MAX?: string
  RATE_LIMIT_WINDOW_SECONDS?: string
  CIRCUIT_FAILURE_THRESHOLD?: string
  CIRCUIT_COOLDOWN_SECONDS?: string
  HIGH_VALUE_USD_THRESHOLD?: string
  MEV_PROTECTION_MODE?: string
  MEV_MAX_SLIPPAGE_BPS?: string
  PRIVATE_TX_RELAY_URL?: string
}

export interface RateLimitConfig {
  /** Max requests per caller per window. */
  max: number
  /** Fixed-window length. */
  windowSeconds: number
}

export interface CircuitBreakerConfig {
  /** Consecutive failures (>=5xx or thrown) that open the circuit. */
  failureThreshold: number
  /** Seconds the circuit stays open before a half-open trial is allowed. */
  cooldownSeconds: number
  /** USD value above which a request is "high value" (undefined = disabled). */
  highValueUsdThreshold: number | undefined
}

export type MevProtectionMode = "off" | "client" | "private"

export interface MevProtectionConfig {
  mode: MevProtectionMode
  /** Slippage-tolerance ceiling in basis points (client-side sandwich guard). */
  maxSlippageBps: number
  /** Configured private relay endpoint, or null when unset/invalid. */
  privateRelayUrl: string | null
}

export const RATE_LIMIT_DEFAULTS: RateLimitConfig = { max: 60, windowSeconds: 60 }
export const CIRCUIT_DEFAULTS: CircuitBreakerConfig = { failureThreshold: 5, cooldownSeconds: 30, highValueUsdThreshold: undefined }
export const MEV_DEFAULTS: MevProtectionConfig = { mode: "client", maxSlippageBps: 500, privateRelayUrl: null }

/** Workers KV enforces a 60s minimum TTL; helper keeps callers honest. */
export function kvTtlSeconds(seconds: number): number {
  return Math.max(60, Math.ceil(seconds))
}

/** Parse a positive integer env var; malformed/non-positive → fallback. */
export function parsePositiveInt(raw: unknown, fallback: number): number {
  if (typeof raw !== "string") return fallback
  const parsed = Number.parseInt(raw.trim(), 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

/** Parse a positive, finite float env var; malformed → undefined. */
export function parsePositiveFloat(raw: unknown): number | undefined {
  if (typeof raw !== "string") return undefined
  const parsed = Number.parseFloat(raw.trim())
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined
}

export function readRateLimitConfig(env: SafetyEnv): RateLimitConfig {
  return {
    max: parsePositiveInt(env.RATE_LIMIT_MAX, RATE_LIMIT_DEFAULTS.max),
    windowSeconds: parsePositiveInt(env.RATE_LIMIT_WINDOW_SECONDS, RATE_LIMIT_DEFAULTS.windowSeconds),
  }
}

export function readCircuitBreakerConfig(env: SafetyEnv): CircuitBreakerConfig {
  return {
    failureThreshold: parsePositiveInt(env.CIRCUIT_FAILURE_THRESHOLD, CIRCUIT_DEFAULTS.failureThreshold),
    cooldownSeconds: parsePositiveInt(env.CIRCUIT_COOLDOWN_SECONDS, CIRCUIT_DEFAULTS.cooldownSeconds),
    highValueUsdThreshold: parsePositiveFloat(env.HIGH_VALUE_USD_THRESHOLD),
  }
}

export function readMevProtectionConfig(env: SafetyEnv): MevProtectionConfig {
  const rawMode = env.MEV_PROTECTION_MODE
  const mode: MevProtectionMode = rawMode === "off" || rawMode === "client" || rawMode === "private" ? rawMode : "client"
  const relay = env.PRIVATE_TX_RELAY_URL?.trim() ?? ""
  const privateRelayUrl = /^https?:\/\//.test(relay) ? relay : null
  return {
    mode,
    maxSlippageBps: parsePositiveInt(env.MEV_MAX_SLIPPAGE_BPS, MEV_DEFAULTS.maxSlippageBps),
    privateRelayUrl,
  }
}
