export const V3_INDEXER_NAME = "v3-liquidity"
export const V3_INDEXER_MAX_RANGE = 2_000n
export const V3_INDEXER_CONFIRMATIONS = 12n

export function finalizedV3Head(latestBlock: bigint): bigint {
  return latestBlock > V3_INDEXER_CONFIRMATIONS ? latestBlock - V3_INDEXER_CONFIRMATIONS : 0n
}

export function nextV3IndexerRange(
  cursor: bigint | null,
  latestBlock: bigint,
  deploymentBlock = 0n,
): { readonly fromBlock: bigint; readonly toBlock: bigint } | null {
  if (latestBlock < 0n) return null
  const fromBlock = cursor ?? deploymentBlock
  if (fromBlock > latestBlock) return null
  return {
    fromBlock,
    toBlock: fromBlock + V3_INDEXER_MAX_RANGE - 1n < latestBlock ? fromBlock + V3_INDEXER_MAX_RANGE - 1n : latestBlock,
  }
}
