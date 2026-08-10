/**
 * AetherDEX Atomic Counter Durable Object
 *
 * Single-writer serialization point for the KV-backed safety middlewares
 * (rate limiting, circuit-breaker failure counts, half-open trial claims).
 *
 * Cloudflare KV offers no compare-and-swap or increment, so a get-then-put
 * read-modify-write on a counter is a lost-update race under concurrency
 * (two requests read the same count and both write count+1). Routing the RMW
 * through one DO instance per key (`idFromName`) makes it atomic: every
 * request for a key is serialized on that instance, and the read-modify-write
 * runs inside `blockConcurrencyWhile` so storage awaits cannot interleave.
 *
 * Endpoints (all POST):
 *   /increment  { amount, ttlMs } → { value, expiresAt } — atomically adds
 *               `amount` to the key's counter, resetting to `amount` when the
 *               window (`expiresAt`) has passed. Used for rate-limit counts
 *               (amount 1, window ttlMs) and breaker failure streaks (amount =
 *               failure weight, ttlMs = failure-window).
 *   /claim      { ttlMs }         → { claimed }          — atomically claims a
 *               short-TTL single-flight marker (half-open trial slot).
 *   /reset                        → { ok: true }          — clears the key.
 */

interface CounterRecord {
  value: number
  expiresAt: number
}

interface IncrementRequest {
  amount: number
  ttlMs: number
}

interface ClaimRequest {
  ttlMs: number
}

export class AtomicCounterDO implements DurableObject {
  private readonly ctx: DurableObjectState

  constructor(ctx: DurableObjectState) {
    this.ctx = ctx
  }

  async fetch(request: Request): Promise<Response> {
    if (request.method !== "POST") return new Response("Method not allowed", { status: 405 })
    const url = new URL(request.url)
    if (url.pathname === "/increment") return this.increment((await request.json()) as IncrementRequest)
    if (url.pathname === "/claim") return this.claim((await request.json()) as ClaimRequest)
    if (url.pathname === "/reset") {
      await this.ctx.blockConcurrencyWhile(() => this.ctx.storage.deleteAll())
      return Response.json({ ok: true })
    }
    return new Response("Not found", { status: 404 })
  }

  private async increment(input: IncrementRequest): Promise<Response> {
    const result = await this.ctx.blockConcurrencyWhile(async () => {
      const now = Date.now()
      const record = await this.ctx.storage.get<CounterRecord>("v")
      // Expired records are overwritten in place on the next call (no storage TTL
      // in this runtime's put options), so per-key storage stays one row.
      const active = record !== undefined && record.expiresAt > now
      const value = (active ? record.value : 0) + input.amount
      const expiresAt = active ? record.expiresAt : now + input.ttlMs
      await this.ctx.storage.put<CounterRecord>("v", { value, expiresAt })
      return { value, expiresAt }
    })
    return Response.json(result)
  }

  private async claim(input: ClaimRequest): Promise<Response> {
    const claimed = await this.ctx.blockConcurrencyWhile(async () => {
      const now = Date.now()
      const record = await this.ctx.storage.get<CounterRecord>("claim")
      if (record !== undefined && record.expiresAt > now) return false
      await this.ctx.storage.put<CounterRecord>("claim", { value: 1, expiresAt: now + input.ttlMs })
      return true
    })
    return Response.json({ claimed })
  }
}
