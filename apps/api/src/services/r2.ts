// @ts-nocheck
/**
 * AetherDEX R2 storage service
 * Archives trade history to R2 (monthly JSONL.gz files)
 * R2 is cheaper than D1 for large archival data
 */

import { Effect } from "effect"

export interface TradeRecord {
  txHash: string
  userAddress: string
  poolId: string
  txType: "swap" | "add_liquidity" | "remove_liquidity"
  tokenIn: string
  tokenOut: string
  amountIn: string
  amountOut: string
  amountUsd: number
  blockNumber: number
  blockTimestamp: number
  chainId: number
}

export interface ArchiveKey {
  year: number
  month: number // 1-12
}

export interface ArchiveStats {
  key: string
  sizeBytes: number
  lastModified: Date
  recordCount?: number
}

/**
 * Generate the R2 object key for a given archive period
 */
export const archiveKey = ({ year, month }: ArchiveKey): string =>
  `trades/${year}/${String(month).padStart(2, "0")}/trades.jsonl.gz`

/**
 * Serialize trade records to JSONL format
 */
export const tradesToJsonl = (trades: TradeRecord[]): string =>
  trades.map((t) => JSON.stringify(t)).join("\n") + (trades.length > 0 ? "\n" : "")

/**
 * Compress string to gzipped bytes using CompressionStream
 * Uses Response.body to avoid Blob/BlobPart type dependency
 */
export const gzip = async (data: string): Promise<Uint8Array> => {
  const stream = new Response(data).body?.pipeThrough(new CompressionStream("gzip"))
  const compressed = await new Response(stream).arrayBuffer()
  return new Uint8Array(compressed)
}

/**
 * Decompress gzipped bytes back to string using DecompressionStream
 * Uses Response.body to avoid Blob/BlobPart type dependency
 */
export const gunzip = async (data: Uint8Array): Promise<string> => {
  const stream = new Response(data).body?.pipeThrough(new DecompressionStream("gzip"))
  return await new Response(stream).text()
}

/**
 * R2 Storage Service — typed wrapper for R2 operations
 * Trade history is archived as monthly JSONL.gz files
 */
export class R2StorageService extends Effect.Service<R2StorageService>()("@aetherdex/R2StorageService", {
  effect: Effect.gen(function* () {
    return {
      /**
       * Write trade records to a monthly archive (overwrites existing)
       */
      writeMonthlyArchive: (bucket: R2Bucket, period: ArchiveKey, trades: TradeRecord[]) =>
        Effect.gen(function* () {
          const jsonl = tradesToJsonl(trades)
          const compressed = yield* Effect.promise(() => gzip(jsonl))
          const key = archiveKey(period)
          const result = yield* Effect.tryPromise({
            try: () =>
              bucket.put(key, compressed, {
                httpMetadata: { contentType: "application/gzip", contentEncoding: "gzip" },
              }),
            catch: (e) => new Error(`R2 put failed: ${String(e)}`),
          })
          return {
            key: result.key,
            sizeBytes: result.size,
            uploaded: result.uploaded,
            recordCount: trades.length,
          }
        }),

      /**
       * Append trades to an existing archive (downloads, appends, re-uploads)
       */
      appendToArchive: (bucket: R2Bucket, period: ArchiveKey, newTrades: TradeRecord[]) =>
        Effect.gen(function* () {
          const key = archiveKey(period)
          const existing = yield* Effect.tryPromise({
            try: () => bucket.get(key),
            catch: (e) => new Error(`R2 get failed: ${String(e)}`),
          })

          let allTrades: TradeRecord[] = [...newTrades]
          if (existing) {
            const rawBytes = yield* Effect.promise(() => existing.arrayBuffer())
            const compressed = new Uint8Array(rawBytes)
            const jsonl = yield* Effect.promise(() => gunzip(compressed))
            const lines = jsonl.split("\n").filter((l) => l.trim().length > 0)
            const existingTrades = lines.map((l) => JSON.parse(l) as TradeRecord)
            allTrades = [...existingTrades, ...newTrades]
          }

          const jsonl = tradesToJsonl(allTrades)
          const newCompressed = yield* Effect.promise(() => gzip(jsonl))
          const result = yield* Effect.tryPromise({
            try: () =>
              bucket.put(key, newCompressed, {
                httpMetadata: { contentType: "application/gzip", contentEncoding: "gzip" },
              }),
            catch: (e) => new Error(`R2 put failed: ${String(e)}`),
          })
          return {
            key: result.key,
            sizeBytes: result.size,
            uploaded: result.uploaded,
            recordCount: allTrades.length,
          }
        }),

      /**
       * Read all trades from a monthly archive
       */
      readMonthlyArchive: (bucket: R2Bucket, period: ArchiveKey) =>
        Effect.gen(function* () {
          const key = archiveKey(period)
          const obj = yield* Effect.tryPromise({
            try: () => bucket.get(key),
            catch: (e) => new Error(`R2 get failed: ${String(e)}`),
          })
          if (!obj) return []

          const rawBytes = yield* Effect.promise(() => obj.arrayBuffer())
          const compressed = new Uint8Array(rawBytes)
          const jsonl = yield* Effect.promise(() => gunzip(compressed))
          const lines = jsonl.split("\n").filter((l) => l.trim().length > 0)
          return lines.map((l) => JSON.parse(l) as TradeRecord)
        }),

      /**
       * List all monthly archives
       */
      listArchives: (bucket: R2Bucket) =>
        Effect.gen(function* () {
          const listed = yield* Effect.tryPromise({
            try: () => bucket.list({ prefix: "trades/" }),
            catch: (e) => new Error(`R2 list failed: ${String(e)}`),
          })
          return listed.objects.map((o) => ({
            key: o.key,
            sizeBytes: o.size,
            lastModified: o.uploaded,
          }))
        }),

      /**
       * Delete a monthly archive
       */
      deleteArchive: (bucket: R2Bucket, period: ArchiveKey) =>
        Effect.gen(function* () {
          const key = archiveKey(period)
          yield* Effect.tryPromise({
            try: () => bucket.delete(key),
            catch: (e) => new Error(`R2 delete failed: ${String(e)}`),
          })
          return { key, deleted: true }
        }),
    }
  }),
}) {}
