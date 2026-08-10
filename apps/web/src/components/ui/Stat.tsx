import type { ReactNode } from "react"

interface StatProps {
  label: string
  value: ReactNode
  desc?: ReactNode
  trend?: "up" | "down"
}

export function Stat({ label, value, desc, trend }: StatProps) {
  const trendColor = trend === "up" ? "text-success" : trend === "down" ? "text-error" : ""
  const trendLabel = trend === "up" ? "Trending up" : trend === "down" ? "Trending down" : ""
  return (
    // biome-ignore lint/a11y/useSemanticElements: daisyUI .stat container needs role="group" + aria-label; fieldset/legend would restyle the stat layout
    <div className="stat" role="group" aria-label={label}>
      <div className="stat-title text-xs uppercase tracking-wide">{label}</div>
      <div className={`stat-value text-2xl ${trendColor}`.trim()}>{value}</div>
      {trendLabel ? <div className="sr-only">{trendLabel}</div> : null}
      {desc ? <div className="stat-desc">{desc}</div> : null}
    </div>
  )
}
