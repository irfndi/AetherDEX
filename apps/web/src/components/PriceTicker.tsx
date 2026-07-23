import { Minus, TrendingDown, TrendingUp } from "lucide-react"
import { useEffect, useMemo, useState } from "react"
import { useWebSocket } from "../hooks/useWebSocket"

/** One refreshed token price as broadcast by the API's WebSocket hub DO. */
interface PricePayload {
  tokenAddress: string
  price: number
  updatedAt?: number
  change24h?: number
  volume24h?: number
}

/** The hub wraps every frame in an envelope; the payload lives in `data`. */
interface PriceEnvelope {
  type: string
  data?: PricePayload
}

interface PriceTickerProps {
  tokenAddress: string
  chainId?: number
  wsUrl?: string
  className?: string
  showVolume?: boolean
}

function formatPrice(price: number): string {
  if (price >= 1_000) return `$${price.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  if (price >= 1) return `$${price.toFixed(4)}`
  if (price >= 0.01) return `$${price.toFixed(6)}`
  return `$${price.toFixed(8)}`
}

function formatPercent(value: number): string {
  const sign = value >= 0 ? "+" : ""
  return `${sign}${value.toFixed(2)}%`
}

function formatVolume(volume: number): string {
  if (volume >= 1_000_000) return `$${(volume / 1_000_000).toFixed(2)}M`
  if (volume >= 1_000) return `$${(volume / 1_000).toFixed(1)}K`
  return `$${volume.toFixed(0)}`
}

export function PriceTicker({
  tokenAddress,
  chainId = 1,
  wsUrl,
  className = "",
  showVolume = false,
}: PriceTickerProps) {
  const defaultWs = `${import.meta.env.VITE_WS_URL ?? "ws://localhost:8080"}/ws/prices/${tokenAddress}?chainId=${chainId}`
  const url = wsUrl ?? defaultWs

  const { data: envelope, isConnected, error } = useWebSocket<PriceEnvelope>({ url })

  // The hub broadcasts ALL token prices (it is a single shared instance); keep the
  // latest payload for THIS ticker's token, unwrapped out of the frame envelope.
  const [data, setData] = useState<PricePayload | null>(null)
  useEffect(() => {
    const payload = envelope?.data
    if (
      payload &&
      typeof payload.price === "number" &&
      payload.tokenAddress.toLowerCase() === tokenAddress.toLowerCase()
    ) {
      setData(payload)
    }
  }, [envelope, tokenAddress])

  const trend = useMemo(() => {
    if (!data?.change24h) return "neutral"
    if (data.change24h > 0) return "up"
    if (data.change24h < 0) return "down"
    return "neutral"
  }, [data?.change24h])

  const trendColor = {
    up: "text-success",
    down: "text-error",
    neutral: "text-base-content/60",
  }[trend]

  const TrendIcon = trend === "up" ? TrendingUp : trend === "down" ? TrendingDown : Minus

  if (error && !data) {
    return (
      <div className={`flex items-center gap-2 ${className}`.trim()}>
        <span className="loading loading-spinner loading-sm" />
        <span className="text-sm text-error">Connection failed</span>
      </div>
    )
  }

  return (
    <div className={`flex items-center gap-3 ${className}`.trim()}>
      <div className="flex items-center gap-1.5">
        <span className={`inline-block size-2 rounded-full ${isConnected ? "bg-success" : "bg-warning"}`} />
        <span className="text-sm font-semibold tabular-nums text-base-content">
          {data ? formatPrice(data.price) : "—"}
        </span>
      </div>

      {data?.change24h !== undefined && (
        <span className={`flex items-center gap-1 text-xs font-medium ${trendColor}`}>
          <TrendIcon size={14} />
          {formatPercent(data.change24h)}
        </span>
      )}

      {showVolume && data?.volume24h !== undefined && (
        <span className="text-xs text-base-content/50">Vol {formatVolume(data.volume24h)}</span>
      )}
    </div>
  )
}
