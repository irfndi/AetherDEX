import { useQuery } from "@tanstack/react-query"
import { shortenAddress } from "../lib/address"
import { Card, CardBody, CardTitle } from "./ui"

interface DexScreenerPair {
  chainId: string
  dexId: string
  url: string
  pairAddress: string
  baseToken: { address: string; name: string; symbol: string }
  quoteToken: { address: string; name: string; symbol: string }
  priceNative: string
  priceUsd: string
  volume: { h24: number; h6: number; h1: number }
  priceChange: { h24: number; h6: number; h1: number }
  liquidity: { usd: number; base: number; quote: number }
  fdv: number
  marketCap: number
}

interface PoolStatsProps {
  tokenAddress: string
  chainId?: number
  className?: string
}

function formatUsd(value: number): string {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`
  if (value >= 1_000) return `$${(value / 1_000).toFixed(1)}K`
  return `$${value.toFixed(2)}`
}

function formatChange(value: number): string {
  const sign = value >= 0 ? "+" : ""
  return `${sign}${value.toFixed(2)}%`
}

export function PoolStats({ tokenAddress, chainId, className = "" }: PoolStatsProps) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["pool-stats", tokenAddress, chainId],
    queryFn: async () => {
      const res = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${tokenAddress}`)
      if (!res.ok) throw new Error(`DexScreener API error: ${res.status}`)
      const json = (await res.json()) as { pairs: DexScreenerPair[] }

      let pairs = json.pairs
      if (chainId !== undefined) {
        const chainMap: Record<number, string> = {
          1: "ethereum",
          8453: "base",
          11155111: "sepolia",
          84532: "base-sepolia",
        }
        const chainName = chainMap[chainId] ?? "ethereum"
        pairs = pairs.filter((p) => p.chainId === chainName)
      }

      // Pick the pair with highest liquidity
      return pairs.sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0))[0] ?? null
    },
    staleTime: 30_000,
  })

  if (isLoading) {
    return (
      <Card className={className}>
        <CardBody>
          <div className="flex items-center gap-2">
            <span className="loading loading-spinner loading-sm" />
            <span className="text-sm text-base-content/60">Loading pool stats…</span>
          </div>
        </CardBody>
      </Card>
    )
  }

  if (error || !data) {
    return (
      <Card className={className}>
        <CardBody>
          <p className="text-sm text-base-content/60">No pool data available for this token.</p>
        </CardBody>
      </Card>
    )
  }

  return (
    <Card className={className}>
      <CardBody>
        <CardTitle className="text-lg">
          {data.baseToken.symbol} / {data.quoteToken.symbol}
        </CardTitle>
        <p className="mb-4 text-xs text-base-content/50">
          {shortenAddress(data.pairAddress)} · {data.dexId}
        </p>

        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <div>
            <p className="text-xs uppercase tracking-wide text-base-content/50">Price</p>
            <p className="text-lg font-semibold tabular-nums">${data.priceUsd}</p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wide text-base-content/50">Liquidity (TVL)</p>
            <p className="text-lg font-semibold tabular-nums">{formatUsd(data.liquidity?.usd ?? 0)}</p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wide text-base-content/50">Volume 24h</p>
            <p className="text-lg font-semibold tabular-nums">{formatUsd(data.volume?.h24 ?? 0)}</p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wide text-base-content/50">24h Change</p>
            <p
              className={`text-lg font-semibold tabular-nums ${
                (data.priceChange?.h24 ?? 0) >= 0 ? "text-success" : "text-error"
              }`}
            >
              {formatChange(data.priceChange?.h24 ?? 0)}
            </p>
          </div>
        </div>
      </CardBody>
    </Card>
  )
}
