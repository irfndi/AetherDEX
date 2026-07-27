import { Context, Effect, Layer } from "effect"
import { SqlClient } from "effect/unstable/sql"
import { createPublicClient, http } from "viem"
import { insertLiquidityEvent } from "../db/queries"
import type { RawLog } from "./v3-liquidity-events"
import { parseV3LiquidityLog } from "./v3-liquidity-events"

export type V3PoolIndexConfig = {
  readonly address: `0x${string}`
  readonly poolId: string
}

export type V3LiquidityIndexerConfig = {
  readonly chainId: number
  readonly rpcUrl: string
  readonly positionManager: `0x${string}`
  readonly pools: readonly V3PoolIndexConfig[]
}

export class V3LiquidityIndexerError {
  readonly _tag = "V3LiquidityIndexerError"
  constructor(readonly message: string) {}
}

export function assertIndexerChainId(configuredChainId: number, rpcChainId: number): void {
  if (rpcChainId !== configuredChainId) {
    throw new V3LiquidityIndexerError(`RPC chain ${rpcChainId} does not match configured chain ${configuredChainId}`)
  }
}

export interface V3LiquidityIndexer {
  readonly indexRange: (fromBlock: bigint, toBlock: bigint) => Effect.Effect<number, V3LiquidityIndexerError>
  readonly latestBlock: Effect.Effect<bigint, V3LiquidityIndexerError>
}

export const V3LiquidityIndexer = Context.Service<V3LiquidityIndexer>("@aetherdex/V3LiquidityIndexer")

const makeV3LiquidityIndexer = (config: V3LiquidityIndexerConfig) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const client = createPublicClient({ transport: http(config.rpcUrl) })

    const verifyRpcChain = Effect.gen(function* () {
      const rpcChainId = yield* Effect.tryPromise({
        try: () => client.getChainId(),
        catch: (error) =>
          new V3LiquidityIndexerError(
            `Unable to read the v3 RPC chain: ${error instanceof Error ? error.message : String(error)}`,
          ),
      })
      yield* Effect.try({
        try: () => assertIndexerChainId(config.chainId, rpcChainId),
        catch: (error) =>
          error instanceof V3LiquidityIndexerError ? error : new V3LiquidityIndexerError(String(error)),
      })
    })

    const latestBlock = Effect.gen(function* () {
      yield* verifyRpcChain
      return yield* Effect.tryPromise({
        try: () => client.getBlockNumber(),
        catch: (error) =>
          new V3LiquidityIndexerError(
            `Unable to read the latest v3 block: ${error instanceof Error ? error.message : String(error)}`,
          ),
      })
    })

    const indexRange = (fromBlock: bigint, toBlock: bigint) =>
      Effect.gen(function* () {
        yield* verifyRpcChain
        if (fromBlock < 0n || toBlock < fromBlock) {
          return yield* Effect.fail(new V3LiquidityIndexerError("Invalid v3 indexer block range"))
        }
        const logs = yield* Effect.tryPromise({
          try: async () => {
            const addresses = [config.positionManager, ...config.pools.map((pool) => pool.address)]
            return Promise.all(addresses.map((address) => client.getLogs({ address, fromBlock, toBlock })))
          },
          catch: (error) =>
            new V3LiquidityIndexerError(
              `Unable to read v3 logs: ${error instanceof Error ? error.message : String(error)}`,
            ),
        })
        const poolByAddress = new Map(config.pools.map((pool) => [pool.address.toLowerCase(), pool]))
        const parsed = logs.flatMap((addressLogs) =>
          addressLogs.flatMap((log) => {
            const raw = toRawLog(log)
            if (!raw) return []
            const pool = poolByAddress.get(raw.address.toLowerCase())
            const event = parseV3LiquidityLog(raw, {
              positionManager: config.positionManager,
              poolAddress: pool?.address,
              poolId: pool?.poolId,
            })
            return event ? [{ event, blockNumber: raw.blockNumber }] : []
          }),
        )
        const timestampByBlock = new Map<bigint, number>()
        for (const item of parsed) {
          if (!timestampByBlock.has(item.blockNumber)) {
            const block = yield* Effect.tryPromise({
              try: () => client.getBlock({ blockNumber: item.blockNumber }),
              catch: (error) =>
                new V3LiquidityIndexerError(
                  `Unable to read block timestamp: ${error instanceof Error ? error.message : String(error)}`,
                ),
            })
            timestampByBlock.set(item.blockNumber, Number(block.timestamp))
          }
        }
        for (const item of parsed) {
          const event = item.event
          yield* insertLiquidityEvent({
            chainId: config.chainId,
            protocol: event.protocol,
            eventType: event.eventType,
            txHash: event.txHash,
            logIndex: event.logIndex,
            blockNumber: event.blockNumber,
            blockTimestamp: timestampByBlock.get(item.blockNumber) ?? 0,
            poolId: event.poolId,
            tokenId: event.tokenId,
            ownerAddress: event.ownerAddress,
            tickLower: event.tickLower,
            tickUpper: event.tickUpper,
            liquidityDelta: event.liquidityDelta,
            amount0: event.amount0,
            amount1: event.amount1,
          }).pipe(Effect.provideService(SqlClient.SqlClient, sql))
        }
        return parsed.length
      }).pipe(
        Effect.catch((error) =>
          error instanceof V3LiquidityIndexerError
            ? Effect.fail(error)
            : Effect.fail(new V3LiquidityIndexerError(String(error))),
        ),
      )

    return { indexRange, latestBlock }
  })

export const V3LiquidityIndexerLive = (config: V3LiquidityIndexerConfig) =>
  Layer.effect(V3LiquidityIndexer, makeV3LiquidityIndexer(config))

function toRawLog(log: {
  readonly address: `0x${string}`
  readonly data: `0x${string}`
  readonly topics: readonly `0x${string}`[]
  readonly transactionHash: `0x${string}` | null
  readonly logIndex: bigint | number | null
  readonly blockNumber: bigint | number | null
}): (RawLog & { readonly blockNumber: bigint }) | null {
  if (log.transactionHash === null || log.logIndex === null || log.blockNumber === null) return null
  return {
    address: log.address,
    data: log.data,
    topics: log.topics,
    transactionHash: log.transactionHash,
    logIndex: BigInt(log.logIndex),
    blockNumber: BigInt(log.blockNumber),
  }
}
