import { describe, expect, it } from "vitest"
import { nextV3IndexerRange, V3_INDEXER_INITIAL_LOOKBACK, V3_INDEXER_MAX_RANGE } from "../src/workers/v3-indexer-cursor"

describe("v3 indexer cursor", () => {
  it("starts from a bounded lookback and caps each scheduled range", () => {
    expect(nextV3IndexerRange(null, V3_INDEXER_INITIAL_LOOKBACK + 100n)).toEqual({
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
})
