/**
 * AetherDEX D1 client setup with Effect SQL
 */

import { Context, Layer } from "effect"
import { SqlClient } from "@effect/sql"
import { D1Client } from "@effect/sql-d1"
import type { WorkerEnv } from "../layers/WorkerEnv"

export interface Db {
  readonly _: never
}

export const Db = Context.GenericTag<Db>("@aetherdex/Db")

/**
 * Create the D1 database layer from a D1Database binding.
 * Maps snake_case SQL columns to camelCase TS via schema converters in schema.ts.
 */
export const makeDbLayer = (db: D1Database): Layer.Layer<SqlClient.SqlClient, never> =>
  D1Client.layer({ db }) as Layer.Layer<SqlClient.SqlClient, never>

/**
 * Helper: get SQL client from D1 binding
 */
export const getDbLayer = (env: WorkerEnv): Layer.Layer<SqlClient.SqlClient, never> =>
  makeDbLayer(env.DB)
