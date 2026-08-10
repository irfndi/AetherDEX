import { Schema } from "effect"
import { describe, expect, it } from "vitest"
import { ListPools, PoolsRpcGroup } from "../rpc"
import { ListPoolsPayloadSchema, PoolListResponseSchema, PoolSchema, TokenSchema } from "../schema"

const poolFixture = {
  poolId: "0xpool",
  token0Address: "0xtoken0",
  token1Address: "0xtoken1",
  fee: 3000,
  tickSpacing: 60,
  hookAddress: null,
  sqrtPriceX96: "340282366920938463463374607431768211456",
  currentTick: 0,
  liquidity: "12345678901234567890",
  tvlUsd: 1234.56,
  volume24hUsd: 5678.9,
  fees24hUsd: 12.34,
  isActive: true,
  createdAt: 1710000000000,
  updatedAt: 1710000000001,
}

const tokenFixture = {
  chainId: 1,
  address: "0xtoken",
  symbol: "TEST",
  name: "Test Token",
  decimals: 18,
  logoUrl: null,
  isVerified: true,
  isNative: false,
  totalSupply: null,
  createdAt: 1710000000000,
  updatedAt: 1710000000000,
}

describe("PoolSchema", () => {
  it("round-trips a valid pool", () => {
    const encoded = Schema.encodeSync(PoolSchema)(poolFixture)
    expect(Schema.decodeUnknownSync(PoolSchema)(encoded)).toEqual(poolFixture)
  })

  it("rejects fractional values for integer-only fields", () => {
    expect(() => Schema.decodeUnknownSync(PoolSchema)({ ...poolFixture, fee: 3000.5 })).toThrow()
    expect(() => Schema.decodeUnknownSync(PoolSchema)({ ...poolFixture, currentTick: 0.5 })).toThrow()
    expect(Schema.decodeUnknownSync(PoolSchema)(poolFixture).fee).toBe(3000)
  })

  it("rejects a missing field and a non-string sqrtPriceX96", () => {
    expect(() => Schema.decodeUnknownSync(PoolSchema)({ ...poolFixture, isActive: undefined })).toThrow()
    expect(() => Schema.decodeUnknownSync(PoolSchema)({ ...poolFixture, sqrtPriceX96: 1n })).toThrow()
  })
})

describe("TokenSchema", () => {
  it("round-trips a valid token and enforces integer chainId/decimals", () => {
    const encoded = Schema.encodeSync(TokenSchema)(tokenFixture)
    expect(Schema.decodeUnknownSync(TokenSchema)(encoded)).toEqual(tokenFixture)
    expect(() => Schema.decodeUnknownSync(TokenSchema)({ ...tokenFixture, decimals: 17.5 })).toThrow()
  })
})

describe("ListPools RPC contract", () => {
  it("uses the wrapper response schema, not a bare array", () => {
    expect(ListPools.successSchema).toBe(PoolListResponseSchema)
  })

  it("constructs the RpcGroup and round-trips a payload", () => {
    expect(PoolsRpcGroup).toBeDefined()
    const payload = Schema.decodeUnknownSync(ListPoolsPayloadSchema)({ limit: 25 })
    expect(payload.limit).toBe(25)
    const response = Schema.decodeUnknownSync(PoolListResponseSchema)({
      pools: [poolFixture],
      count: 1,
    })
    expect(response.count).toBe(1)
    expect(response.pools[0]?.poolId).toBe("0xpool")
  })
})
