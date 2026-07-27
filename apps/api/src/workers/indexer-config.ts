import type { PublicClient } from "viem"
import { parseChainId } from "../lib/chain-id"
import type { IndexerChainConfig } from "../services/indexer.service"

export interface IndexerEnvConfig {
  readonly CHAIN_ID: string
  readonly RPC_URL?: string
  readonly INDEXER_ENABLED?: string
  readonly INDEXER_BATCH_SIZE?: string
  readonly V3_POSITION_MANAGER_ADDRESS?: string
  readonly V3_INDEXED_POOL_ADDRESSES?: string
  readonly V4_POOL_MANAGER_ADDRESS?: string
}

export const isIndexerEnabled = (env: IndexerEnvConfig): boolean => env.INDEXER_ENABLED?.trim().toLowerCase() === "true"

const isHexAddress = (value: string): value is `0x${string}` => /^0x[a-fA-F0-9]{40}$/.test(value)

const parseBatchSize = (value: string | undefined): number | undefined => {
  if (value === undefined) return undefined
  const trimmed = value.trim()
  if (!/^[1-9]\d*$/.test(trimmed)) return undefined
  const parsed = Number.parseInt(trimmed, 10)
  return Number.isSafeInteger(parsed) ? parsed : undefined
}

/**
 * Build the Phase 3 indexer chain config from env vars. Returns `null` when
 * the chain id, RPC URL, or every source contract is missing — callers treat
 * `null` as a no-op. Never throws. `clientFactory` is a test seam; production
 * omits it so IndexerServiceLive builds the default viem HTTP client.
 */
export const buildIndexerChainConfig = (
  env: IndexerEnvConfig,
  clientFactory?: (rpcUrl: string) => PublicClient,
): IndexerChainConfig | null => {
  const chainId = parseChainId(env.CHAIN_ID)
  const rpcUrl = env.RPC_URL
  if (chainId === null || !rpcUrl) return null

  const v3PositionManager =
    env.V3_POSITION_MANAGER_ADDRESS !== undefined && isHexAddress(env.V3_POSITION_MANAGER_ADDRESS)
      ? env.V3_POSITION_MANAGER_ADDRESS
      : undefined
  const v3Pools = (env.V3_INDEXED_POOL_ADDRESSES ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(isHexAddress)
  const v4PoolManager =
    env.V4_POOL_MANAGER_ADDRESS !== undefined && isHexAddress(env.V4_POOL_MANAGER_ADDRESS)
      ? env.V4_POOL_MANAGER_ADDRESS
      : undefined

  if (v3PositionManager === undefined && v3Pools.length === 0 && v4PoolManager === undefined) return null

  const batchSize = parseBatchSize(env.INDEXER_BATCH_SIZE)

  return {
    chainId,
    rpcUrl,
    ...(batchSize !== undefined ? { batchSize } : {}),
    contracts: {
      ...(v3PositionManager !== undefined ? { v3PositionManager } : {}),
      ...(v3Pools.length > 0 ? { v3Pools } : {}),
      ...(v4PoolManager !== undefined ? { v4PoolManager } : {}),
    },
    ...(clientFactory !== undefined ? { clientFactory } : {}),
  }
}
