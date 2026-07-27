/**
 * Phase-3 API safety — KV-backed circuit breaker for high-value endpoints.
 *
 * States (classic closed → open → half-open):
 *   - closed:    failures accumulate in cb:<name>_failures (metadata { count, failedAt },
 *                TTL-garbage-collected). At failureThreshold the circuit opens.
 *   - open:      fast-rejects with 503 + Retry-After until cooldownSeconds elapse
 *                (measured from openedAt stored under cb:<name>_state).
 *   - half-open: after cooldown ONE trial request is admitted; success closes the
 *                circuit (state + failures cleared), failure re-opens it immediately.
 *
 * Default keys for the swap breaker follow the agreed namespace exactly:
 *   cb:swap_failures / cb:state. Other breakers use cb:<name>_failures / cb:<name>_state.
 *
 * A 5xx response OR a thrown handler error counts as a failure. Requests flagged
 * by isHighValueRequest count with a heavier weight, so abnormal high-value
 * failure patterns trip the breaker sooner. KV missing/erroring → fail open
 * (log + continue) unless the circuit state is explicitly open.
 */

import type { Context, Next } from "hono"
import type { AuthVariables } from "../auth/middleware"
import { kvTtlSeconds, readCircuitBreakerConfig, type SafetyEnv } from "../lib/safety-config"

export type CircuitBreakerMiddleware = (
  c: Context<{ Variables: AuthVariables }>,
  next: Next,
) => Promise<Response | undefined>

export interface CircuitStateRecord {
  status: "open" | "half_open"
  openedAt: number
}

export interface CircuitBreakerOptions {
  /** Logical breaker name (default "swap" — uses the canonical cb:state key). */
  name?: string
  /** Override the failures counter key. Default: cb:<name>_failures. */
  failuresKey?: string
  /** Override the state key. Default: cb:state (swap) / cb:<name>_state. */
  stateKey?: string
  /** Override CIRCUIT_FAILURE_THRESHOLD. */
  failureThreshold?: number
  /** Override CIRCUIT_COOLDOWN_SECONDS. */
  cooldownSeconds?: number
  /** Failure weight for high-value requests (default 2). */
  highValueFailureWeight?: number
  /** Per-request predicate; true weights failures by highValueFailureWeight. */
  isHighValueRequest?: (c: Context<{ Variables: AuthVariables }>) => boolean | Promise<boolean>
}

function defaultKeys(name: string): { failuresKey: string; stateKey: string } {
  return {
    failuresKey: `cb:${name}_failures`,
    stateKey: name === "swap" ? "cb:state" : `cb:${name}_state`,
  }
}

async function readState(kv: KVNamespace, stateKey: string): Promise<CircuitStateRecord | null> {
  try {
    const raw = await kv.get(stateKey)
    if (!raw) return null
    const parsed = JSON.parse(raw) as { status?: unknown; openedAt?: unknown }
    if (
      (parsed.status === "open" || parsed.status === "half_open") &&
      typeof parsed.openedAt === "number" &&
      Number.isFinite(parsed.openedAt)
    ) {
      return { status: parsed.status, openedAt: parsed.openedAt }
    }
    return null
  } catch (error) {
    console.warn("[circuit-breaker] state read failed; treating as closed:", error)
    return null
  }
}

async function writeState(kv: KVNamespace, stateKey: string, record: CircuitStateRecord, cooldownSeconds: number) {
  try {
    await kv.put(stateKey, JSON.stringify(record), {
      // TTL only garbage-collects; cooldown timing is enforced against openedAt.
      expirationTtl: kvTtlSeconds(Math.max(cooldownSeconds * 3, 60)),
    })
  } catch (error) {
    console.warn("[circuit-breaker] state write failed:", error)
  }
}

async function recordFailure(
  kv: KVNamespace,
  failuresKey: string,
  stateKey: string,
  failureThreshold: number,
  cooldownSeconds: number,
  weight: number,
  trial: boolean,
  name: string,
): Promise<void> {
  const now = Date.now()
  if (trial) {
    // Half-open trial failed — the dependency is still down; re-open immediately.
    await writeState(kv, stateKey, { status: "open", openedAt: now }, cooldownSeconds)
    console.warn(`[circuit-breaker] breaker "${name}" RE-OPENED (half-open trial failed)`)
    return
  }

  let count = weight
  try {
    const { metadata } = await kv.getWithMetadata(failuresKey)
    if (metadata !== null && typeof metadata === "object") {
      const previous = (metadata as { count?: unknown }).count
      if (typeof previous === "number" && Number.isFinite(previous)) count = previous + weight
    }
  } catch (error) {
    console.warn("[circuit-breaker] failure read failed; starting a new streak:", error)
  }

  try {
    await kv.put(failuresKey, String(count), {
      expirationTtl: kvTtlSeconds(cooldownSeconds * 2),
      metadata: { count, failedAt: now },
    })
    if (count >= failureThreshold) {
      await writeState(kv, stateKey, { status: "open", openedAt: now }, cooldownSeconds)
      console.warn(`[circuit-breaker] breaker "${name}" OPEN after ${count} failures (threshold ${failureThreshold})`)
    }
  } catch (error) {
    console.warn("[circuit-breaker] failure write failed:", error)
  }
}

async function closeCircuit(kv: KVNamespace, failuresKey: string, stateKey: string, name: string): Promise<void> {
  try {
    await Promise.all([kv.delete(failuresKey), kv.delete(stateKey)])
    console.warn(`[circuit-breaker] breaker "${name}" CLOSED (half-open trial succeeded)`)
  } catch (error) {
    console.warn("[circuit-breaker] close failed:", error)
  }
}

/**
 * Route-scoped circuit breaker. Mount inline, outside the auth guard and
 * downstream of rateLimit():
 *   router.post("/build", rateLimit(), circuitBreaker({ name: "swap" }), handler)
 */
export function circuitBreaker(options: CircuitBreakerOptions = {}): CircuitBreakerMiddleware {
  const name = options.name ?? "swap"
  const keys = defaultKeys(name)
  const failuresKey = options.failuresKey ?? keys.failuresKey
  const stateKey = options.stateKey ?? keys.stateKey

  return async (c, next) => {
    // c.env is undefined when a sub-router is exercised directly (app.request without env).
    const env = (c.env ?? {}) as SafetyEnv
    const kv = env.CACHE
    if (!kv) {
      console.warn("[circuit-breaker] CACHE KV binding missing — failing open")
      await next()
      return
    }

    const envConfig = readCircuitBreakerConfig(env)
    const failureThreshold = options.failureThreshold ?? envConfig.failureThreshold
    const cooldownSeconds = options.cooldownSeconds ?? envConfig.cooldownSeconds
    const now = Date.now()

    const state = await readState(kv, stateKey)
    let trial = false
    if (state !== null) {
      const elapsedMs = now - state.openedAt
      if (elapsedMs < cooldownSeconds * 1000) {
        const retryAfter = Math.max(1, Math.ceil((cooldownSeconds * 1000 - elapsedMs) / 1000))
        c.header("Retry-After", String(retryAfter))
        c.header("X-Circuit-Breaker", "open")
        return c.json({ error: "Service temporarily unavailable (circuit open). Retry later." }, 503)
      }
      // Cooldown elapsed: admit exactly one probe request.
      trial = true
      await writeState(kv, stateKey, { status: "half_open", openedAt: state.openedAt }, cooldownSeconds)
    }

    let weight = 1
    if (options.isHighValueRequest) {
      try {
        const highValue = await options.isHighValueRequest(c)
        if (highValue) weight = options.highValueFailureWeight ?? 2
      } catch {
        // A probe failure must not break the request — treat as normal value.
      }
    }

    let thrown = false
    let failed = false
    try {
      await next()
      failed = c.res.status >= 500
    } catch (error) {
      thrown = true
      failed = true
      console.error(`[circuit-breaker] handler threw on ${c.req.method} ${c.req.path}:`, error)
    }

    if (failed) {
      await recordFailure(kv, failuresKey, stateKey, failureThreshold, cooldownSeconds, weight, trial, name)
      // A thrown handler would otherwise surface as an opaque worker error;
      // return the standard API error shape instead.
      if (thrown) return c.json({ error: "Internal server error" }, 500)
      return
    }

    if (trial) {
      await closeCircuit(kv, failuresKey, stateKey, name)
    }
    return
  }
}
