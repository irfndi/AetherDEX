import { TokenChip } from "../TokenChip"
import { type Token, TokenSearch } from "../TokenSearch"

interface SwapAmountFieldProps {
  label: string
  value: string
  onChange: (value: string) => void
  token: Token | null
  onTokenChange: (token: Token) => void
  placeholder?: string
  readOnly?: boolean
}

export function SwapAmountField({
  label,
  value,
  onChange,
  token,
  onTokenChange,
  placeholder = "0.0",
  readOnly = false,
}: SwapAmountFieldProps) {
  return (
    <div className="rounded-xl border hairline bg-base-200/60 p-4">
      <div className="mb-1 flex items-center justify-between text-xs text-base-content/60">
        <span>{label}</span>
        <span>Balance: 0.0</span>
      </div>
      <div className="flex items-center gap-3">
        <input
          type="text"
          inputMode="decimal"
          aria-label={label}
          placeholder={placeholder}
          value={value}
          readOnly={readOnly}
          onChange={(e) => onChange(e.target.value.replace(/[^0-9.]/g, ""))}
          className="input flex-1 border-0 bg-transparent p-0 text-3xl font-medium focus:outline-none"
        />
        <TokenSearch onSelect={onTokenChange} selectedToken={token} placeholder="Search token" />
      </div>
      {token ? (
        <div className="mt-2">
          <TokenChip token={token} />
        </div>
      ) : null}
    </div>
  )
}
