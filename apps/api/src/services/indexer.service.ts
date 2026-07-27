import { Context, Data, Effect, Layer } from "effect"
import { SqlClient } from "effect/unstable/sql"
import { createPublicClient, http, type PublicClient } from "viem"
import { getPoolById, insertLiquidityEvent, recordSwap, setIndexerCursor, upsertPool, upsertUser } from "../db/queries"
import type { Pool } from "../db/schema"
import { parseV4PoolManagerLog, toRawLog, type V4PoolManagerEvent, type V4SwapEvent } from "./indexer-events"
import type { RawLog, V3LiquidityEvent } from "./v3-liquidity-events"
import { parseV3LiquidityLog } from "./v3-liquidity-events"

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
  /**
   * Optional override for the viem PublicClient. Production builds the default
   * HTTP client from `rpcUrl`; tests inject a deterministic fake.
   */
  readonly clientFactory?: (rpcUrl: string) => PublicClient
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

const defaultClientFactory = (rpcUrl: string): PublicClient => createPublicClient({ transport: http(rpcUrl) })

/** A decoded event that maps to one or more idempotent D1 writes. */
type ParsedIndexerEvent =
  | { readonly kind: "v3"; readonly event: V3LiquidityEvent; readonly block: number }
  | { readonly kind: "v4"; readonly event: V4PoolManagerEvent; readonly block: number }

const makeIndexerService = (chains: readonly IndexerChainConfig[]) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient

    const clients = new Map<number, PublicClient>()
    const configByChain = new Map<number, IndexerChainConfig>()

    for (const chain of chains) {
      const factory = chain.clientFactory ?? defaultClientFactory
      clients.set(chain.chainId, factory(chain.rpcUrl))
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
      setIndexerCursor(chainId, source, nextBlock).pipe(
        Effect.provideService(SqlClient.SqlClient, sql),
        Effect.mapError((e) => new IndexerError({ reason: `Cursor write failed: ${String(e)}`, chainId })),
      )

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

    /** Parse a raw log for the given source, or `null` when it is not relevant. */
    const parseForSource = (
      config: IndexerChainConfig,
      source: IndexerSource,
      raw: RawLog,
    ): ParsedIndexerEvent | null => {
      const block = Number(raw.blockNumber)
      switch (source) {
        case "v3_position_manager": {
          const event = parseV3LiquidityLog(raw, { positionManager: config.contracts.v3PositionManager })
          return event ? { kind: "v3", event, block } : null
        }
        case "v3_pool": {
          // The indexer config carries addresses only, so the (chain-unique) pool
          // address doubles as the identifying poolId.
          const event = parseV3LiquidityLog(raw, {
            poolAddress: raw.address,
            poolId: raw.address.toLowerCase(),
          })
          return event ? { kind: "v3", event, block } : null
        }
        case "v4_pool_manager": {
          const event = parseV4PoolManagerLog(raw)
          return event ? { kind: "v4", event, block } : null
        }
      }
    }

    /** blockNumber -> unix seconds, fetched once per block per batch. */
    const loadTimestamps = (chainId: number, client: PublicClient, blocks: readonly number[]) =>
      Effect.gen(function* () {
        const timestampByBlock = new Map<number, number>()
        for (const blockNumber of blocks) {
          if (timestampByBlock.has(blockNumber)) continue
          const block = yield* Effect.tryPromise({
            try: () => client.getBlock({ blockNumber: BigInt(blockNumber) }),
            catch: (e) => new IndexerError({ reason: `RPC getBlock: ${String(e)}`, chainId }),
          })
          timestampByBlock.set(blockNumber, Number(block.timestamp))
        }
        return timestampByBlock
      })

    const persistV3 = (chainId: number, event: V3LiquidityEvent, blockTimestamp: number) =>
      insertLiquidityEvent({
        chainId,
        protocol: event.protocol,
        eventType: event.eventType,
        txHash: event.txHash,
        logIndex: event.logIndex,
        blockNumber: event.blockNumber,
        blockTimestamp,
        poolId: event.poolId,
        tokenId: event.tokenId,
        ownerAddress: event.ownerAddress,
        tickLower: event.tickLower,
        tickUpper: event.tickUpper,
        liquidityDelta: event.liquidityDelta,
        amount0: event.amount0,
        amount1: event.amount1,
      })

    const swapSides = (event: V4SwapEvent, pool: Pool | null) => {
      // amount0 > 0 => currency0 flows INTO the pool: trader spends currency0.
      if (event.amount0 > 0n) {
        return {
          tokenIn: pool?.token0Address ?? null,
          tokenOut: pool?.token1Address ?? null,
          amountIn: event.amount0.toString(),
          amountOut: (-event.amount1).toString(),
        }
      }
      if (event.amount0 < 0n) {
        return {
          tokenIn: pool?.token1Address ?? null,
          tokenOut: pool?.token0Address ?? null,
          amountIn: event.amount1.toString(),
          amountOut: (-event.amount0).toString(),
        }
      }
      return { tokenIn: null, tokenOut: null, amountIn: null, amountOut: null }
    }

    const persistV4 = (chainId: number, event: V4PoolManagerEvent, blockTimestamp: number) =>
      Effect.gen(function* () {
        switch (event.kind) {
          case "initialize":
            yield* upsertPool({
              chainId,
              poolId: event.poolId,
              token0Address: event.currency0,
              token1Address: event.currency1,
              fee: event.fee,
              tickSpacing: event.tickSpacing,
              hookAddress: event.hooks,
              sqrtPriceX96: event.sqrtPriceX96,
              currentTick: event.tick,
              liquidity: "0",
              tvlUsd: 0,
              volume24hUsd: 0,
              fees24hUsd: 0,
              isActive: true,
            })
            return
          case "swap": {
            const pool = yield* getPoolById(event.poolId, chainId)
            if (pool) {
              yield* upsertPool({
                chainId: pool.chainId,
                poolId: pool.poolId,
                token0Address: pool.token0Address,
                token1Address: pool.token1Address,
                fee: pool.fee,
                tickSpacing: pool.tickSpacing,
                hookAddress: pool.hookAddress,
                sqrtPriceX96: event.sqrtPriceX96,
                currentTick: event.tick,
                liquidity: event.liquidity,
                tvlUsd: pool.tvlUsd,
                volume24hUsd: pool.volume24hUsd,
                fees24hUsd: pool.fees24hUsd,
                isActive: pool.isActive,
              })
            }
            // D1 enforces FKs: the swap's user must exist, and pool_id may only
            // reference a persisted pool (a swap indexed before its Initialize).
            yield* upsertUser(event.sender)
            yield* recordSwap({
              chainId,
              txHash: event.txHash,
              userAddress: event.sender,
              poolId: pool ? event.poolId : null,
              ...swapSides(event, pool),
              amountUsd: null,
              blockNumber: event.blockNumber,
              blockTimestamp,
            })
            return
          }
          case "modify_liquidity":
            yield* insertLiquidityEvent({
              chainId,
              protocol: "v4",
              eventType: event.liquidityDelta >= 0n ? "increase" : "decrease",
              txHash: event.txHash,
              logIndex: event.logIndex,
              blockNumber: event.blockNumber,
              blockTimestamp,
              poolId: event.poolId,
              tokenId: null,
              ownerAddress: event.sender,
              tickLower: event.tickLower,
              tickUpper: event.tickUpper,
              liquidityDelta: event.liquidityDelta.toString(),
              amount0: null,
              amount1: null,
            })
            return
        }
      })

    const persistEvent = (chainId: number, item: ParsedIndexerEvent, timestampByBlock: Map<number, number>) => {
      const blockTimestamp = timestampByBlock.get(item.block) ?? 0
      return item.kind === "v3"
        ? persistV3(chainId, item.event, blockTimestamp)
        : persistV4(chainId, item.event, blockTimestamp)
    }

    /**
     * Decode every relevant log in the batch and write it to D1 using the
     * conflict-guarded queries (ON CONFLICT ... DO NOTHING / DO UPDATE), so a
     * batch that overlaps a previously indexed range never duplicates rows.
     */
    const persistBatch = (
      chainId: number,
      source: IndexerSource,
      config: IndexerChainConfig,
      logs: readonly RawLog[],
    ) =>
      Effect.gen(function* () {
        const parsed: ParsedIndexerEvent[] = []
        for (const raw of logs) {
          const item = parseForSource(config, source, raw)
          if (item) parsed.push(item)
        }
        if (parsed.length === 0) return 0

        const uniqueBlocks = [...new Set(parsed.map((item) => item.block))]
        const client = yield* getClient(chainId)
        const timestampByBlock = yield* loadTimestamps(chainId, client, uniqueBlocks)

        for (const item of parsed) {
          yield* persistEvent(chainId, item, timestampByBlock)
        }
        return parsed.length
      }).pipe(
        Effect.provideService(SqlClient.SqlClient, sql),
        Effect.mapError((e) => new IndexerError({ reason: `Persist failed: ${String(e)}`, chainId })),
      )

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
        const fetched =
          addresses.length > 0
            ? yield* Effect.tryPromise({
                try: () => client.getLogs({ address: addresses, fromBlock, toBlock }),
                catch: (e) => new IndexerError({ reason: `RPC getLogs: ${String(e)}`, chainId }),
              })
            : []

        const logs: RawLog[] = []
        for (const log of fetched) {
          const raw = toRawLog(log)
          if (raw) logs.push(raw)
        }

        // Persist BEFORE advancing the cursor so a persist failure leaves the
        // range to be retried instead of silently skipped.
        const eventsProcessed = yield* persistBatch(chainId, source, config, logs)
        yield* saveCursor(chainId, source, toBlock + 1n)

        return { source, fromBlock, toBlock, eventsProcessed, cursorAdvanced: true }
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
