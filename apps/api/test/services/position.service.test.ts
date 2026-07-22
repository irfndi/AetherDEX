import { Effect, Layer } from "effect"
import { SqlClient } from "effect/unstable/sql"
import { describe, expect, it } from "vitest"
import {
  PositionService,
  PositionServiceLive,
  RecordPositionError,
  type RecordPositionInput,
} from "../../src/services/position.service"

const validInput: RecordPositionInput = {
  userAddress: "0x1111111111111111111111111111111111111111",
  poolId: "0x2222222222222222222222222222222222222222222222222222222222222222",
  tickLower: -60,
  tickUpper: 60,
  liquidity: "1000",
  amount0: "10",
  amount1: "20",
}

const fakeSqlLayer = (rows: ReadonlyArray<unknown>) => {
  const fakeSql = ((..._parts: ReadonlyArray<unknown>) => Effect.succeed(rows)) as unknown as SqlClient.SqlClient
  return Layer.succeed(SqlClient.SqlClient, fakeSql)
}

const withService = <A, E>(
  program: (svc: PositionService) => Effect.Effect<A, E, never>,
  rows: ReadonlyArray<unknown>,
) =>
  Effect.gen(function* () {
    const svc = yield* PositionService
    return yield* program(svc)
  }).pipe(Effect.provide(PositionServiceLive.pipe(Layer.provide(fakeSqlLayer(rows)))))

describe("PositionService.recordPosition", () => {
  it("resolves with the generated id when RETURNING id yields a row", async () => {
    const id = await Effect.runPromise(withService((svc) => svc.recordPosition(validInput), [{ id: 42 }]))
    expect(id).toBe(42)
  })

  it("fails the Effect when INSERT returns no id instead of masking it with 0", async () => {
    const err = await Effect.runPromise(Effect.flip(withService((svc) => svc.recordPosition(validInput), [])))
    expect(err).toBeInstanceOf(RecordPositionError)
  })

  it("fails the Effect when the returned row has no id column", async () => {
    const err = await Effect.runPromise(
      Effect.flip(withService((svc) => svc.recordPosition(validInput), [{ other: 1 }])),
    )
    expect(err).toBeInstanceOf(RecordPositionError)
  })
})

describe("PositionService.listByUser", () => {
  const row = {
    id: 7,
    user_address: "0x1111111111111111111111111111111111111111",
    pool_id: "0x2222222222222222222222222222222222222222222222222222222222222222",
    tick_lower: -60,
    tick_upper: 60,
    liquidity: "1000",
    amount0: "10",
    amount1: "20",
    fees_earned_token0: "0",
    fees_earned_token1: "0",
    is_active: 1,
    created_at: 1719715200,
    updated_at: 1719715200,
  }

  it("maps D1 rows to LiquidityPosition objects", async () => {
    const list = await Effect.runPromise(withService((svc) => svc.listByUser(row.user_address), [row]))
    expect(list).toHaveLength(1)
    expect(list[0]).toMatchObject({ id: 7, poolId: row.pool_id, tickLower: -60, tickUpper: 60, isActive: true })
  })

  it("returns an empty list when the user has no positions", async () => {
    const list = await Effect.runPromise(
      withService((svc) => svc.listByUser("0x9999999999999999999999999999999999999999"), []),
    )
    expect(list).toEqual([])
  })
})

describe("PositionService error surfacing", () => {
  it("fails with PositionListError-typed failure when SQL throws", async () => {
    const failingSql = ((..._parts: ReadonlyArray<unknown>) =>
      Effect.fail(new Error("D1 exploded"))) as unknown as SqlClient.SqlClient
    const err = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* PositionService
        return yield* svc.listByUser("0x1111111111111111111111111111111111111111")
      }).pipe(
        Effect.provide(PositionServiceLive.pipe(Layer.provide(Layer.succeed(SqlClient.SqlClient, failingSql)))),
        Effect.flip,
      ),
    )
    expect(String((err as { cause: string }).cause)).toContain("D1 exploded")
  })
})
