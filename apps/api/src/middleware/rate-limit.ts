/**
 * Phase-3 API safety — KV-backed fixed-window rate limiting.
 *
 * Applied route-scoped to high-value mutation endpoints only (POST /swap/build,
 * /swap/record, /positions writes) — never to /health, /ws/*, or public GETs.
 *
 * Caller identity (in precedence order):
 *   1. the authenticated wallet address (SIWE session)   → rl:addr:<address>
 *   2. cf-connecting-ip, else first x-forwarded-for hop  → rl:ip:<ip>
 *   3. anonymous                                         → rl:ip:anonymous
 *
 * Counters live in the atomic-counter Durable Object (COUNTER binding) — one
 * DO instance per caller key makes the read-modify-write atomic (Cloudflare KV
 * has no CAS/increment). Without the binding, counters fall back to the CACHE
 * KV namespace as window metadata ({ count, resetAt }) with a TTL for garbage
 * collection — approximate under concurrency, fail-open on KV errors.
 */

import type { Context, Next } from "hono"
import type { AuthVariables } from "../auth/middleware"
import { kvTtlSeconds, type RateLimitConfig, readRateLimitConfig, type SafetyEnv } from "../lib/safety-config"

export type RateLimitMiddleware = (
  c: Context<{ Variables: AuthVariables }>,
  next: Next,
) => Promise<Response | undefined>

export interface CallerIdentity {
  kind: "address" | "ip"
  /** Namespaced KV key for this caller's counter. */
  key: string
}

export interface RateLimitOutcome {
  allowed: boolean
  limit: number
  remaining: number
  /** Epoch ms when the current window resets. */
  resetAt: number
}

interface WindowMetadata {
  count: number
  resetAt: number
}

/** Resolve the caller for rate-limit bucketing. Exported for reuse + tests. */
export function identifyCaller(c: Context<{ Variables: AuthVariables }>): CallerIdentity {
  const session = c.get("session")
  const address = session?.userAddress
  if (typeof address === "string" && /^0x[a-fA-F0-9]{40}$/.test(address)) {
    return { kind: "address", key: `rl:addr:${address.toLowerCase()}` }
  }
  return { kind: "ip", key: `rl:ip:${extractClientIp(c)}` }
}

function extractClientIp(c: Context<{ Variables: AuthVariables }>): string {
  const cfIp = c.req.header("cf-connecting-ip")?.trim()
  if (cfIp) return cfIp
  const forwarded = c.req.header("x-forwarded-for")
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim()
    if (first) return first
  }
  return "anonymous"
}

function readWindow(metadata: unknown, nowMs: number): WindowMetadata | null {
  if (metadata === null || typeof metadata !== "object") return null
  const { count, resetAt } = metadata as { count?: unknown; resetAt?: unknown }
  if (typeof count !== "number" || typeof resetAt !== "number") return null
  if (!Number.isFinite(count) || !Number.isFinite(resetAt) || resetAt <= nowMs) return null
  return { count, resetAt }
}

/**
 * Consume one request from the caller's fixed window. Uses the atomic-counter
 * DO when bound (single-writer per key — Cloudflare KV has no CAS, so the KV
 * fallback below is only approximate under concurrency). Throws on storage
 * errors (the middleware catches and fails open).
 */
export async function consumeRateLimit(
  kv: KVNamespace,
  counter: DurableObjectNamespace | null,
  key: string,
  config: RateLimitConfig,
  nowMs: number = Date.now(),
): Promise<RateLimitOutcome> {
  if (counter) {
    const stub = counter.get(counter.idFromName(key))
    const response = await stub.fetch("https://counter/increment", {
      method: "POST",
      body: JSON.stringify({ amount: 1, ttlMs: config.windowSeconds * 1000 }),
    })
    const { value, expiresAt } = (await response.json()) as { value: number; expiresAt: number }
    return {
      allowed: value <= config.max,
      limit: config.max,
      remaining: Math.max(0, config.max - value),
      resetAt: expiresAt,
    }
  }

  // ponytail: KV fallback (COUNTER binding missing) — the get/put is not
  // atomic, so counts are approximate under concurrency; move to the DO
  // binding to get exact windows.
  const { metadata } = await kv.getWithMetadata(key)
  const existing = readWindow(metadata, nowMs)
  const resetAt = existing?.resetAt ?? nowMs + config.windowSeconds * 1000
  const count = (existing?.count ?? 0) + 1
  const allowed = count <= config.max
  await kv.put(key, String(count), {
    // Guard the write path too: a failed put must not take the process down —
    // the middleware wraps consumeRateLimit in try/catch.
    expirationTtl: kvTtlSeconds(config.windowSeconds + 1),
    metadata: { count, resetAt },
  })
  return { allowed, limit: config.max, remaining: Math.max(0, config.max - count), resetAt }
}

export interface RateLimitOptions {
  /** Override RATE_LIMIT_MAX for this route. */
  max?: number
  /** Override RATE_LIMIT_WINDOW_SECONDS for this route. */
  windowSeconds?: number
}

/**
 * Route-scoped limiter. Mount inline on mutation routes:
 *   router.post("/build", rateLimit(), requireAuth, handler)
 */
export function rateLimit(options: RateLimitOptions = {}): RateLimitMiddleware {
  return async (c, next) => {
    // c.env is undefined when a sub-router is exercised directly (app.request without env).
    const env = (c.env ?? {}) as SafetyEnv
    const kv = env.CACHE
    if (!kv) {
      console.warn("[rate-limit] CACHE KV binding missing — failing open")
      await next()
      return
    }

    const fromEnv = readRateLimitConfig(env)
    const config: RateLimitConfig = {
      max: options.max ?? fromEnv.max,
      windowSeconds: options.windowSeconds ?? fromEnv.windowSeconds,
    }
    const caller = identifyCaller(c)
    const counter = env.COUNTER ?? null

    let outcome: RateLimitOutcome
    try {
      outcome = await consumeRateLimit(kv, counter, caller.key, config)
    } catch (error) {
      console.warn(`[rate-limit] KV error (${caller.kind}); failing open:`, error)
      await next()
      return
    }

    c.header("X-RateLimit-Limit", String(outcome.limit))
    c.header("X-RateLimit-Remaining", String(outcome.remaining))

    if (!outcome.allowed) {
      const retryAfter = Math.max(1, Math.ceil((outcome.resetAt - Date.now()) / 1000))
      c.header("Retry-After", String(retryAfter))
      return c.json({ error: "Rate limit exceeded. Try again later." }, 429)
    }

    await next()
    return
  }
}
