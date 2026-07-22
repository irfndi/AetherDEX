/**
 * Hono ↔ Effect bridge.
 *
 * The npm package `@hono/effect` does not exist and no community Hono/Effect
 * bridge supports Effect v4, so Hono handlers resolve their business logic by
 * running fully-provided Effect programs. Routes build their program, provide
 * the service layer + the request-scoped D1 layer, and hand the resulting
 * `Effect<_, _, never>` to `runEffect`.
 */

import { Effect } from "effect"

export function runEffect<A, E>(program: Effect.Effect<A, E, never>): Promise<A> {
  return Effect.runPromise(program)
}
