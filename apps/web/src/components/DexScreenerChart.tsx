import type { IframeHTMLAttributes } from "react"

interface DexScreenerChartProps extends Omit<IframeHTMLAttributes<HTMLIFrameElement>, "src" | "title"> {
  tokenAddress: string
  chainId?: number
  theme?: "dark" | "light"
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
  const chainMap: Record<number, string> = {
    1: "ethereum",
    8453: "base",
    11155111: "sepolia",
    84532: "base-sepolia",
  }

  const chainName = chainMap[chainId] ?? "ethereum"
  const src = `https://dexscreener.com/${chainName}/${tokenAddress}?embed=1&theme=${theme}&chart=smart&chartType=mc`

  return (
    <div className={`relative w-full overflow-hidden rounded-lg border border-base-300 ${className}`.trim()}>
      <iframe
        src={src}
        title={`DexScreener chart for ${tokenAddress}`}
        className="h-[500px] w-full border-0"
        loading="lazy"
        allow="clipboard-write"
        {...rest}
      />
    </div>
  )
}
