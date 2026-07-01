/**
 * AetherDEX Hono auth middleware
 *
 * 1. authMiddleware — extracts Bearer token from Authorization header,
 *    loads session from KV, attaches to context. Non-destructive:
 *    routes without auth still work (session will be undefined).
 *
 * 2. requireAuth — guard middleware that returns 401 if no valid session.
 *    Use after authMiddleware to protect specific routes.
 */

import type { Context, Next } from "hono"
import type { AuthSession } from "./siwe"

export type AuthVariables = {
  session?: AuthSession
  sessionToken?: string
}

/**
 * Extracts Bearer token → loads session from KV → attaches to c.var.
 * Runs on every request; non-authenticated requests pass through.
 */
export async function authMiddleware(
  c: Context<{ Variables: AuthVariables }>,
  next: Next,
): Promise<Response | undefined> {
  const authHeader = c.req.header("Authorization")
  if (!authHeader?.startsWith("Bearer ")) {
    await next()
    return
  }

  const token = authHeader.slice("Bearer ".length)
  if (!token) {
    await next()
    return
  }

  const kv = (c.env as { CACHE: KVNamespace }).CACHE
  const raw = await kv.get(`session:${token}`)
  if (!raw) {
    await next()
    return
  }

  try {
    const session = JSON.parse(raw) as AuthSession
    c.set("session", session)
    c.set("sessionToken", token)
  } catch {
    // Malformed session data — treat as no session
  }

  await next()
  return
}

/**
 * Guard: returns 401 if no authenticated session is attached.
 * Mount after authMiddleware on routes that require authentication.
 */
export async function requireAuth(c: Context<{ Variables: AuthVariables }>, next: Next): Promise<Response> {
  const session = c.get("session")
  if (!session) {
    return c.json({ error: "Authentication required" }, 401)
  }
  await next()
  return c.res
}
