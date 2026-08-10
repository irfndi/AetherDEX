/**
 * R2 archive append — concurrent appends to the same monthly key must be
 * serialized so neither batch is lost in a read-modify-write race.
 */

import { Effect } from "effect"
import { describe, expect, it } from "vitest"
import { gunzip, R2StorageService, type TradeRecord } from "../../src/services/r2"

const trade = (txHash: string): TradeRecord => ({
  txHash,
  userAddress: "0x0000000000000000000000000000000000000001",
  poolId: "0x0000000000000000000000000000000000000002",
  txType: "swap",
  tokenIn: "0x0000000000000000000000000000000000000003",
  tokenOut: "0x0000000000000000000000000000000000000004",
  amountIn: "100",
  amountOut: "99",
  amountUsd: 1,
  blockNumber: 1,
  blockTimestamp: 1,
  chainId: 1,
})

class FakeBucket {
  readonly store = new Map<string, Uint8Array>()
  readonly events: string[] = []

  async get(key: string) {
    this.events.push(`get:${key}`)
    const data = this.store.get(key)
    if (!data) return null
    return {
      arrayBuffer: async () => data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength),
    }
  }

  async put(key: string, value: Uint8Array) {
    this.events.push(`put:${key}`)
    this.store.set(key, value)
    return { key, size: value.byteLength, uploaded: new Date() }
  }

  async list() {
    return { objects: [] }
  }

  async delete(key: string) {
    this.store.delete(key)
  }
}

const period = { year: 2026, month: 8 }

const run = <A>(program: (svc: R2StorageService) => Effect.Effect<A, never>) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const svc = yield* R2StorageService
      return yield* program(svc)
    }).pipe(Effect.provide(R2StorageService.layer)),
  )

const readArchived = async (bucket: FakeBucket): Promise<string[]> => {
  const raw = bucket.store.get("trades/2026/08/trades.jsonl.gz")
  if (!raw) return []
  const jsonl = await gunzip(raw)
  return jsonl
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => (JSON.parse(line) as TradeRecord).txHash)
}

describe("R2StorageService.appendToArchive", () => {
  it("preserves both batches when two sequential appends target the same period", async () => {
    const bucket = new FakeBucket()
    await run((svc) =>
      Effect.all([
        svc.appendToArchive(bucket as unknown as R2Bucket, period, [trade("0xaa")]),
        svc.appendToArchive(bucket as unknown as R2Bucket, period, [trade("0xbb")]),
      ]),
    )
    expect(await readArchived(bucket)).toEqual(["0xaa", "0xbb"])
  })

  it("serializes concurrent appends per key (no lost batch in the read-modify-write race)", async () => {
    const bucket = new FakeBucket()
    await run((svc) =>
      Effect.all(
        [
          svc.appendToArchive(bucket as unknown as R2Bucket, period, [trade("0xaa")]),
          svc.appendToArchive(bucket as unknown as R2Bucket, period, [trade("0xbb")]),
        ],
        { concurrency: "unbounded" },
      ),
    )
    // Every batch survived — the second append read the first's write.
    expect(await readArchived(bucket)).toEqual(["0xaa", "0xbb"])
    // The fake observed strictly alternating get/put per key — the second
    // append's read happened only after the first append's write landed.
    expect(bucket.events).toEqual([
      "get:trades/2026/08/trades.jsonl.gz",
      "put:trades/2026/08/trades.jsonl.gz",
      "get:trades/2026/08/trades.jsonl.gz",
      "put:trades/2026/08/trades.jsonl.gz",
    ])
  })
})
