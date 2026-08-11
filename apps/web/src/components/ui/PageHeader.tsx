import type { ReactNode } from "react"

interface PageHeaderProps {
  title: string
  eyebrow?: string
  description?: string
  actions?: ReactNode
}

/**
 * Consistent page heading — a small "runway" eyebrow, a display title,
 * and an optional description + actions row. Keeps every page's header
 * tuned to the same tracking/scale rhythm.
 */
export function PageHeader({ title, eyebrow, description, actions }: PageHeaderProps) {
  return (
    <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {eyebrow ? (
          <p className="mb-1.5 font-mono text-xs uppercase tracking-[0.22em] text-primary/80">{eyebrow}</p>
        ) : null}
        <h1 className="font-display text-2xl font-medium tracking-tight text-base-content sm:text-3xl">{title}</h1>
        {description ? (
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-base-content/60">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </div>
  )
}
