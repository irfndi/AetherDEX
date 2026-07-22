import { Effect } from "effect"
import { Hono } from "hono"
import { KVCacheService } from "../services/kv"
import { type AuthVariables, authMiddleware, requireAuth } from "./middleware"
import { deleteSession, issueNonce, verifyAndCreateSession } from "./siwe"

const auth = new Hono<{ Bindings: Env; Variables: AuthVariables }>()

auth.use("*", authMiddleware)

auth.post("/nonce", async (c) => {
  const kv = (c.env as { CACHE: KVNamespace }).CACHE

  const result = await Effect.runPromise(issueNonce(kv).pipe(Effect.provide(KVCacheService.layer))).catch((err) => ({
    error: String(err),
  }))

  if ("error" in result) {
    return c.json({ error: result.error }, 500)
  }

  return c.json(result)
})

auth.post("/verify", async (c) => {
  const body = await c.req.json<{ message?: string; signature?: string }>()
  if (!body.message || !body.signature) {
    return c.json({ error: "message and signature are required" }, 400)
  }

  const kv = (c.env as { CACHE: KVNamespace }).CACHE

  const result = await Effect.runPromise(
    verifyAndCreateSession(kv, { message: body.message, signature: body.signature }).pipe(
      Effect.provide(KVCacheService.layer),
    ),
  ).catch((err) => ({ error: String(err) }))

  if ("error" in result) {
    return c.json({ error: result.error }, 401)
  }

  return c.json({
    token: result.token,
    userAddress: result.userAddress,
    expiresAt: result.expiresAt,
  })
})

auth.get("/me", requireAuth, async (c) => {
  return c.json({ session: c.get("session") })
})

auth.post("/logout", requireAuth, async (c) => {
  const token = c.get("sessionToken")
  if (token) {
    const kv = (c.env as { CACHE: KVNamespace }).CACHE
    await Effect.runPromise(deleteSession(kv, token).pipe(Effect.provide(KVCacheService.layer)))
  }
  return c.json({ ok: true })
})

export { auth }
