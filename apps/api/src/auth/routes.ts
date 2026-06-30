import { Effect } from "effect"
import { Hono } from "hono"
import { KVCacheService } from "../services/kv"
import { type AuthVariables, authMiddleware, requireAuth } from "./middleware"
import { deleteSession, issueNonce, verifyAndCreateSession } from "./siwe"

const auth = new Hono<{ Bindings: Env; Variables: AuthVariables }>()

auth.use("*", authMiddleware)

auth.post("/nonce", async (c) => {
  const kv = (c.env as { CACHE: KVNamespace }).CACHE

  const result = await Effect.runPromise(Effect.provide(issueNonce(kv), KVCacheService.Default)).catch((err) => ({
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
    Effect.provide(
      verifyAndCreateSession(kv, { message: body.message, signature: body.signature }),
      KVCacheService.Default,
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
    await Effect.runPromise(Effect.provide(deleteSession(kv, token), KVCacheService.Default))
  }
  return c.json({ ok: true })
})

export { auth }
