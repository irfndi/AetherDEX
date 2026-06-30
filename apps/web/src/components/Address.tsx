interface AddressProps {
  address: string
  length?: number
  className?: string
}

export function Address({ address, length = 4, className = "" }: AddressProps) {
  if (!address || address.length < length * 2 + 3) {
    return <span className={className}>{address}</span>
  }
  const truncated = `${address.slice(0, 2 + length)}\u2026${address.slice(-length)}`
  return (
    <span className={`font-mono text-sm ${className}`.trim()} title={address}>
      {truncated}
    </span>
  )
}
