import { useState } from "react"
import { shortenAddress } from "../lib/address"
import { isSafeImageUrl } from "../lib/image"

export interface Token {
  address: string
  symbol: string
  name: string
  decimals: number
  logoURI?: string
}

interface TokenChipProps {
  token: Token
  onRemove?: () => void
  className?: string
}

export function TokenChip({ token, onRemove, className = "" }: TokenChipProps) {
  const [failedLogoUri, setFailedLogoUri] = useState<string | null>(null)

  const showLogo = token.logoURI !== undefined && isSafeImageUrl(token.logoURI) && failedLogoUri !== token.logoURI
  const showMonogram = token.logoURI !== undefined && !showLogo
  return (
    <div className={`badge badge-outline gap-1 px-3 py-3 ${className}`.trim()}>
      {showLogo ? (
        <img
          src={token.logoURI}
          alt={token.symbol}
          className="size-4 rounded-full"
          referrerPolicy="no-referrer"
          loading="lazy"
          decoding="async"
          onError={() => setFailedLogoUri(token.logoURI ?? null)}
        />
      ) : showMonogram ? (
        <span
          className="flex size-4 items-center justify-center rounded-full bg-base-300 text-[0.625rem] font-semibold"
          aria-hidden="true"
        >
          {token.symbol.charAt(0)}
        </span>
      ) : null}
      <span className="font-semibold">{token.symbol}</span>
      <span className="text-xs text-base-content/50">{shortenAddress(token.address, 3)}</span>
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          className="btn btn-ghost btn-xs ml-1 h-4 min-h-0 w-4 p-0"
          aria-label={`Remove ${token.symbol}`}
        >
          <svg className="size-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" role="img" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      )}
    </div>
  )
}
