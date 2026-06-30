import type { ReactNode } from "react"

interface StatProps {
  label: string
  value: ReactNode
  desc?: ReactNode
  trend?: "up" | "down"
}

export function Stat({ label, value, desc, trend }: StatProps) {
  const trendColor = trend === "up" ? "text-success" : trend === "down" ? "text-error" : ""
  return (
    <div className="stat">
      <div className="stat-title text-xs uppercase tracking-wide">{label}</div>
      <div className={`stat-value text-2xl ${trendColor}`.trim()}>{value}</div>
      {desc ? <div className="stat-desc">{desc}</div> : null}
    </div>
  )
}
