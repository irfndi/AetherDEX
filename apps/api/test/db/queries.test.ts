import { Effect, Layer } from "effect"
import { SqlClient } from "effect/unstable/sql"
import { describe, expect, it } from "vitest"
import { InsertPositionError, type InsertPositionInput, insertPosition } from "../../src/db/queries"

const validInput: InsertPositionInput = {
  userAddress: "0x1111111111111111111111111111111111111111",
  poolId: "0x2222222222222222222222222222222222222222222222222222222222222222",
  tickLower: -60,
  tickUpper: 60,
  liquidity: "1000",
  amount0: "10",
  amount1: "20",
}

const fakeSqlLayer = (rows: ReadonlyArray<unknown>) => {
  const fakeSql = ((..._parts: ReadonlyArray<unknown>) => Effect.succeed(rows)) as unknown as SqlClient
  return Layer.succeed(SqlClient.SqlClient, fakeSql)
}

describe("insertPosition", () => {
  it("resolves with the generated id when RETURNING id yields a row", async () => {
    const id = await Effect.runPromise(insertPosition(validInput).pipe(Effect.provide(fakeSqlLayer([{ id: 42 }]))))
    expect(id).toBe(42)
  })

  it("fails the Effect when INSERT returns no id instead of masking it with 0", async () => {
    const err = await Effect.runPromise(insertPosition(validInput).pipe(Effect.provide(fakeSqlLayer([])), Effect.flip))
    expect(err).toBeInstanceOf(InsertPositionError)
  })

  it("fails the Effect when the returned row has no id column", async () => {
    const err = await Effect.runPromise(
      insertPosition(validInput).pipe(Effect.provide(fakeSqlLayer([{ other: 1 }])), Effect.flip),
    )
    expect(err).toBeInstanceOf(InsertPositionError)
  })
})
