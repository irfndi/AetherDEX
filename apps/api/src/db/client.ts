/**
 * AetherDEX D1 client setup with Effect SQL
 */

import { D1Client } from "@effect/sql-d1"
import { Context } from "effect"
import type { WorkerEnv } from "../layers/WorkerEnv"

export interface Db {
  readonly _: never
}

export const Db = Context.Service<Db>("@aetherdex/Db")

/**
 * Create the D1 database layer from a D1Database binding.
 * Maps snake_case SQL columns to camelCase TS via schema converters in schema.ts.
 *
 * `D1Client.layer` provides both the D1-specific `D1Client` and the generic
 * `SqlClient` services that the Effect service layer depends on.
 */
export const makeDbLayer = (db: D1Database): ReturnType<typeof D1Client.layer> => D1Client.layer({ db })

/**
 * Helper: get SQL client layer from D1 binding
 */
export const getDbLayer = (env: WorkerEnv) => makeDbLayer(env.DB)
