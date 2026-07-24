interface RangeSelectorProps {
  readonly currentTick: number
  readonly tickSpacing: number
  readonly lowerTick: number
  readonly upperTick: number
  readonly onChange: (range: { readonly lowerTick: number; readonly upperTick: number }) => void
}

const HISTOGRAM = [18, 24, 31, 42, 55, 68, 78, 88, 94, 82, 71, 58, 48, 61, 76, 90, 80, 64, 52, 38, 28, 20]

export function RangeSelector({ currentTick, tickSpacing, lowerTick, upperTick, onChange }: RangeSelectorProps) {
  const spacing = Math.max(1, tickSpacing)
  const minimum = snap(Math.floor(currentTick / spacing) * spacing - spacing * 24, spacing)
  const maximum = minimum + spacing * 48
  const lower = clamp(snap(lowerTick, spacing), minimum, maximum - spacing)
  const upper = clamp(snap(upperTick, spacing), lower + spacing, maximum)

  const updateLower = (value: number) => onChange({ lowerTick: Math.min(value, upper - spacing), upperTick: upper })
  const updateUpper = (value: number) => onChange({ lowerTick: lower, upperTick: Math.max(value, lower + spacing) })

  return (
    <fieldset className="rounded-box border border-base-300 bg-base-200/35 p-3" aria-label="Visual price range">
      <div className="mb-3 flex items-center justify-between gap-3 text-xs">
        <span className="font-medium text-base-content/70">Visual range selector</span>
        <span className="font-mono text-base-content/55">Current {currentTick}</span>
      </div>
      <div className="relative h-24 overflow-hidden rounded-box border border-base-300 bg-base-100 px-3 pb-3 pt-5">
        <div className="absolute inset-x-3 bottom-3 flex h-14 items-end gap-1 opacity-70" aria-hidden="true">
          {HISTOGRAM.map((height, index) => (
            <span
              className={`min-w-0 flex-1 rounded-t-sm ${index === 10 || index === 11 ? "bg-primary" : "bg-secondary/45"}`}
              key={`${height}-${index}`}
              style={{ height: `${height}%` }}
            />
          ))}
        </div>
        <div
          className="absolute bottom-3 top-5 rounded-sm border-x-2 border-primary bg-primary/15"
          style={{
            left: `${percentage(lower, minimum, maximum)}%`,
            right: `${100 - percentage(upper, minimum, maximum)}%`,
          }}
          aria-hidden="true"
        />
        <input
          aria-label="Lower tick range handle"
          className="range range-primary absolute inset-x-2 top-2 z-10 h-5 [--range-shdw:transparent]"
          max={maximum - spacing}
          min={minimum}
          step={spacing}
          type="range"
          value={lower}
          onChange={(event) => updateLower(Number(event.target.value))}
        />
        <input
          aria-label="Upper tick range handle"
          className="range range-primary absolute inset-x-2 top-2 z-10 h-5 [--range-shdw:transparent]"
          max={maximum}
          min={minimum + spacing}
          step={spacing}
          type="range"
          value={upper}
          onChange={(event) => updateUpper(Number(event.target.value))}
        />
      </div>
      <div className="mt-3 flex items-center justify-between gap-3 font-mono text-xs">
        <span>Lower {lower}</span>
        <span className="text-base-content/50">Step {spacing}</span>
        <span>Upper {upper}</span>
      </div>
    </fieldset>
  )
}

function snap(value: number, spacing: number): number {
  return Math.round(value / spacing) * spacing
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value))
}

function percentage(value: number, minimum: number, maximum: number): number {
  return ((value - minimum) / (maximum - minimum)) * 100
}
