import type { IframeHTMLAttributes } from "react"

interface DexScreenerChartProps extends Omit<IframeHTMLAttributes<HTMLIFrameElement>, "src" | "title"> {
  tokenAddress: string
  chainId?: number
  theme?: "dark" | "light"
}

const CHAIN_MAP: Record<number, string> = {
  1: "ethereum",
  8453: "base",
  11155111: "sepolia",
  84532: "base-sepolia",
}

/**
 * DexScreener chart embed for a given token address.
 * Uses the official DexScreener embed iframe — no API key required.
 */
export function DexScreenerChart({
  tokenAddress,
  chainId = 1,
  theme = "dark",
  className = "",
  ...rest
}: DexScreenerChartProps) {
  const chainName = CHAIN_MAP[chainId]
  const isValidAddress = /^0x[a-fA-F0-9]{40}$/.test(tokenAddress)
  const wrapperClass = `relative w-full overflow-hidden rounded-lg border hairline ${className}`.trim()

  if (!chainName || !isValidAddress) {
    return (
      <div className={wrapperClass}>
        <p className="p-4 text-center text-sm text-base-content/70">
          {chainName ? "Invalid token address" : "Unsupported chain"}
        </p>
      </div>
    )
  }

  const src = `https://dexscreener.com/${chainName}/${tokenAddress}?embed=1&theme=${encodeURIComponent(theme)}&chart=smart&chartType=mc`

  return (
    <div className={wrapperClass}>
      <iframe
        src={src}
        title={`DexScreener chart for ${tokenAddress}`}
        className="h-[500px] w-full border-0"
        loading="lazy"
        allow="clipboard-write"
        // Sandboxed: the embed runs as a unique origin (no allow-same-origin),
        // so it cannot reach the parent or its own cookies. Scripts, popups,
        // and forms are the minimum it needs to render the chart.
        sandbox="allow-scripts allow-popups allow-forms allow-downloads"
        {...rest}
      />
    </div>
  )
}
