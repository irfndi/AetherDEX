import { Context, Data, Effect, Layer } from "effect"
import { SqlClient } from "effect/unstable/sql"
import { createPublicClient, http, type PublicClient } from "viem"

export class IndexerError extends Data.TaggedError("IndexerError")<{
  readonly reason: string
  readonly chainId: number
}> {}

export type IndexerSource = "v3_position_manager" | "v3_pool" | "v4_pool_manager"

export interface IndexerCursor {
  readonly chainId: number
  readonly source: IndexerSource
  readonly nextBlock: bigint
  readonly updatedAt: number
}

export interface IndexerChainConfig {
  readonly chainId: number
  readonly rpcUrl: string
  readonly batchSize?: number
  readonly contracts: {
    readonly v3PositionManager?: `0x${string}`
    readonly v3Pools?: readonly `0x${string}`[]
    readonly v4PoolManager?: `0x${string}`
  }
  readonly genesisBlock?: bigint
}

export interface IndexResult {
  readonly source: IndexerSource
  readonly fromBlock: bigint
  readonly toBlock: bigint
  readonly eventsProcessed: number
  readonly cursorAdvanced: boolean
}

export interface IndexerService {
  readonly indexBatch: (chainId: number, source: IndexerSource) => Effect.Effect<IndexResult, IndexerError>
  readonly indexChain: (chainId: number) => Effect.Effect<readonly IndexResult[], IndexerError>
  readonly getCursor: (chainId: number, source: IndexerSource) => Effect.Effect<IndexerCursor | null, IndexerError>
}

export const IndexerService = Context.Service<IndexerService>("@aetherdex/IndexerService")

const makeIndexerService = (chains: readonly IndexerChainConfig[]) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient

    const clients = new Map<number, PublicClient>()
    const configByChain = new Map<number, IndexerChainConfig>()

    for (const chain of chains) {
      clients.set(chain.chainId, createPublicClient({ transport: http(chain.rpcUrl) }))
      configByChain.set(chain.chainId, chain)
    }

    const getClient = (chainId: number): Effect.Effect<PublicClient, IndexerError> => {
      const client = clients.get(chainId)
      if (!client) {
        return Effect.fail(new IndexerError({ reason: `No RPC configured for chain ${chainId}`, chainId }))
      }
      return Effect.succeed(client)
    }

    const getCursor = (chainId: number, source: IndexerSource) =>
      Effect.gen(function* () {
        const rows = yield* sql`
          SELECT chain_id, indexer, next_block, updated_at
          FROM indexer_cursors
          WHERE chain_id = ${chainId} AND indexer = ${source}
        `
        if (rows.length === 0) return null
        const row = rows[0] as Record<string, unknown>
        return {
          chainId: Number(row.chain_id),
          source: String(row.indexer) as IndexerSource,
          nextBlock: BigInt(row.next_block as string),
          updatedAt: Number(row.updated_at),
        } satisfies IndexerCursor
      }).pipe(Effect.mapError((e) => new IndexerError({ reason: `Cursor read failed: ${String(e)}`, chainId })))

    const saveCursor = (chainId: number, source: IndexerSource, nextBlock: bigint) =>
      sql`
        INSERT INTO indexer_cursors (chain_id, indexer, next_block, updated_at)
        VALUES (${chainId}, ${source}, ${Number(nextBlock)}, ${Date.now()})
        ON CONFLICT(chain_id, indexer) DO UPDATE SET
          next_block = excluded.next_block,
          updated_at = excluded.updated_at
      `.pipe(Effect.mapError((e) => new IndexerError({ reason: `Cursor write failed: ${String(e)}`, chainId })))

    const sourceAddresses = (config: IndexerChainConfig, source: IndexerSource): `0x${string}`[] => {
      switch (source) {
        case "v3_position_manager":
          return config.contracts.v3PositionManager ? [config.contracts.v3PositionManager] : []
        case "v3_pool":
          return [...(config.contracts.v3Pools ?? [])]
        case "v4_pool_manager":
          return config.contracts.v4PoolManager ? [config.contracts.v4PoolManager] : []
      }
    }

    const resolveStartBlock = (chainId: number, source: IndexerSource, head: bigint) =>
      Effect.gen(function* () {
        const cursor = yield* getCursor(chainId, source)
        if (cursor) return cursor.nextBlock
        const config = configByChain.get(chainId)
        if (config?.genesisBlock !== undefined) return config.genesisBlock
        return head > 10_000n ? head - 10_000n : 0n
      })

    const indexBatch = (chainId: number, source: IndexerSource): Effect.Effect<IndexResult, IndexerError> =>
      Effect.gen(function* () {
        const config = configByChain.get(chainId)
        if (!config) {
          return yield* Effect.fail(new IndexerError({ reason: `No config for chain ${chainId}`, chainId }))
        }

        const client = yield* getClient(chainId)
        const head = yield* Effect.tryPromise({
          try: () => client.getBlockNumber(),
          catch: (e) => new IndexerError({ reason: `RPC getBlockNumber: ${String(e)}`, chainId }),
        })

        const fromBlock = yield* resolveStartBlock(chainId, source, head)
        const batchSize = BigInt(config.batchSize ?? 2000)
        const toBlock = fromBlock + batchSize > head ? head : fromBlock + batchSize

        if (fromBlock > head) {
          return { source, fromBlock, toBlock: head, eventsProcessed: 0, cursorAdvanced: false }
        }

        const addresses = sourceAddresses(config, source)
        const logs =
          addresses.length > 0
            ? yield* Effect.tryPromise({
                try: () => client.getLogs({ address: addresses, fromBlock, toBlock }),
                catch: (e) => new IndexerError({ reason: `RPC getLogs: ${String(e)}`, chainId }),
              })
            : []

        yield* saveCursor(chainId, source, toBlock + 1n)

        return { source, fromBlock, toBlock, eventsProcessed: logs.length, cursorAdvanced: true }
      })

    const indexChain = (chainId: number) =>
      Effect.gen(function* () {
        const sources: readonly IndexerSource[] = ["v3_position_manager", "v3_pool", "v4_pool_manager"]
        const results: IndexResult[] = []
        for (const source of sources) {
          results.push(yield* indexBatch(chainId, source))
        }
        return results as readonly IndexResult[]
      })

    return { indexBatch, indexChain, getCursor }
  })

export const IndexerServiceLive = (chains: readonly IndexerChainConfig[]) =>
  Layer.effect(IndexerService, makeIndexerService(chains))
