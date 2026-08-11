interface PositionValueProps {
  readonly label: string
  readonly value: string
  readonly mono?: boolean
}

export function PositionValue({ label, value, mono = false }: PositionValueProps) {
  return (
    <div>
      <p className="text-xs text-base-content/50">{label}</p>
      <p className={mono ? "font-mono text-sm" : "text-sm"}>{value}</p>
    </div>
  )
}
