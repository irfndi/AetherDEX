import { shortenAddress } from "../lib/address"

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
  return (
    <div className={`badge badge-outline gap-1 px-3 py-3 ${className}`.trim()}>
      {token.logoURI && <img src={token.logoURI} alt={token.symbol} className="h-4 w-4 rounded-full" />}
      <span className="font-semibold">{token.symbol}</span>
      <span className="text-xs text-base-content/50">{shortenAddress(token.address, 3)}</span>
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          className="btn btn-ghost btn-xs ml-1 h-4 min-h-0 w-4 p-0"
          aria-label={`Remove ${token.symbol}`}
        >
          <svg
            className="h-3 w-3"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            role="img"
            aria-label={`Remove ${token.symbol}`}
          >
            <title>{`Remove ${token.symbol}`}</title>
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      )}
    </div>
  )
}
