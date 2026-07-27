import { describe, expect, it } from "vitest"
import { assertIndexerChainId, V3LiquidityIndexerError } from "../src/services/v3-liquidity-indexer.service"
import {
  finalizedV3Head,
  nextV3IndexerRange,
  V3_INDEXER_CONFIRMATIONS,
  V3_INDEXER_MAX_RANGE,
} from "../src/workers/v3-indexer-cursor"

describe("v3 indexer cursor", () => {
  it("starts from the configured deployment block and caps each range", () => {
    expect(nextV3IndexerRange(null, 20_000n, 100n)).toEqual({
      fromBlock: 100n,
      toBlock: 100n + V3_INDEXER_MAX_RANGE - 1n,
    })
  })

  it("continues from the persisted cursor", () => {
    expect(nextV3IndexerRange(25n, 30n)).toEqual({ fromBlock: 25n, toBlock: 30n })
  })

  it("does not schedule a range beyond the chain head", () => {
    expect(nextV3IndexerRange(31n, 30n)).toBeNull()
  })

  it("keeps the confirmation window out of the index", () => {
    expect(finalizedV3Head(100n)).toBe(100n - V3_INDEXER_CONFIRMATIONS)
  })

  it("rejects an RPC on a different chain", () => {
    expect(() => assertIndexerChainId(11155111, 1)).toThrowError(V3LiquidityIndexerError)
  })
})
