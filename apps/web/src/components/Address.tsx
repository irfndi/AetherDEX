interface AddressProps {
  address: string
  length?: number
  className?: string
}

export function Address({ address, length = 4, className = "" }: AddressProps) {
  const chars = Math.max(1, Math.floor(length))
  const display =
    !address || address.length < chars * 2 + 3
      ? address
      : `${address.slice(0, 2 + chars)}\u2026${address.slice(-chars)}`
  return (
    <span className={`font-mono text-sm ${className}`.trim()} title={address}>
      {display}
    </span>
  )
}
