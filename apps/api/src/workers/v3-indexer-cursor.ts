export const V3_INDEXER_NAME = "v3-liquidity"
export const V3_INDEXER_INITIAL_LOOKBACK = 10_000n
export const V3_INDEXER_MAX_RANGE = 2_000n

export function nextV3IndexerRange(
  cursor: bigint | null,
  latestBlock: bigint,
): { readonly fromBlock: bigint; readonly toBlock: bigint } | null {
  if (latestBlock < 0n) return null
  const fromBlock =
    cursor ?? (latestBlock > V3_INDEXER_INITIAL_LOOKBACK ? latestBlock - V3_INDEXER_INITIAL_LOOKBACK : 0n)
  if (fromBlock > latestBlock) return null
  return {
    fromBlock,
    toBlock: fromBlock + V3_INDEXER_MAX_RANGE - 1n < latestBlock ? fromBlock + V3_INDEXER_MAX_RANGE - 1n : latestBlock,
  }
}
