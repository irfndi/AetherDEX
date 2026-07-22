import { Effect, Layer } from "effect"
import { SqlClient } from "effect/unstable/sql"
import { describe, expect, it } from "vitest"
import { PoolReadError, PoolService, PoolServiceLive } from "../../src/services/pool.service"
import { TokenListError, TokenReadError, TokenService, TokenServiceLive } from "../../src/services/token.service"

const POOL_ID = "0x2222222222222222222222222222222222222222222222222222222222222222"
const TOKEN_ADDRESS = "0x1111111111111111111111111111111111111111"

const failingSqlLayer = () => {
  const failingSql = ((..._parts: ReadonlyArray<unknown>) =>
    Effect.fail(new Error("d1 unavailable"))) as unknown as SqlClient.SqlClient
  return Layer.succeed(SqlClient.SqlClient, failingSql)
}

const emptySqlLayer = () => {
  const emptySql = ((..._parts: ReadonlyArray<unknown>) => Effect.succeed([])) as unknown as SqlClient.SqlClient
  return Layer.succeed(SqlClient.SqlClient, emptySql)
}

describe("PoolService storage failures", () => {
  it("fails getPool with PoolReadError instead of null when D1 rejects a valid id", async () => {
    const program = Effect.gen(function* () {
      const poolService = yield* PoolService
      return yield* poolService.getPool(POOL_ID)
    })
    const err = await Effect.runPromise(
      program.pipe(Effect.provide(PoolServiceLive.pipe(Layer.provide(failingSqlLayer()))), Effect.flip),
    )
    expect(err).toBeInstanceOf(PoolReadError)
  })

  it("keeps null for getPool when D1 succeeds with no matching row", async () => {
    const program = Effect.gen(function* () {
      const poolService = yield* PoolService
      return yield* poolService.getPool(POOL_ID)
    })
    const pool = await Effect.runPromise(
      program.pipe(Effect.provide(PoolServiceLive.pipe(Layer.provide(emptySqlLayer())))),
    )
    expect(pool).toBeNull()
  })
})

describe("TokenService storage failures", () => {
  it("fails getToken with TokenReadError instead of null when D1 rejects a valid address", async () => {
    const program = Effect.gen(function* () {
      const tokenService = yield* TokenService
      return yield* tokenService.getToken(TOKEN_ADDRESS)
    })
    const err = await Effect.runPromise(
      program.pipe(Effect.provide(TokenServiceLive.pipe(Layer.provide(failingSqlLayer()))), Effect.flip),
    )
    expect(err).toBeInstanceOf(TokenReadError)
  })

  it("keeps null for getToken when D1 succeeds with no matching row", async () => {
    const program = Effect.gen(function* () {
      const tokenService = yield* TokenService
      return yield* tokenService.getToken(TOKEN_ADDRESS)
    })
    const token = await Effect.runPromise(
      program.pipe(Effect.provide(TokenServiceLive.pipe(Layer.provide(emptySqlLayer())))),
    )
    expect(token).toBeNull()
  })

  it("fails listTokens with TokenListError instead of [] when D1 rejects", async () => {
    const program = Effect.gen(function* () {
      const tokenService = yield* TokenService
      return yield* tokenService.listTokens()
    })
    const err = await Effect.runPromise(
      program.pipe(Effect.provide(TokenServiceLive.pipe(Layer.provide(failingSqlLayer()))), Effect.flip),
    )
    expect(err).toBeInstanceOf(TokenListError)
  })
})
