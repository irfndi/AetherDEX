import type { InputHTMLAttributes } from "react"

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string
  error?: string
}

export function Input({ label, error, className = "", id, ...rest }: InputProps) {
  const inputId = id ?? `input-${Math.random().toString(36).slice(2, 9)}`
  const errorClass = error ? "input-error" : ""
  return (
    <div className="form-control w-full">
      {label ? (
        <label className="label" htmlFor={inputId}>
          <span className="label-text">{label}</span>
        </label>
      ) : null}
      <input id={inputId} className={`input input-bordered w-full ${errorClass} ${className}`.trim()} {...rest} />
      {error ? (
        <label className="label" htmlFor={inputId}>
          <span className="label-text-alt text-error">{error}</span>
        </label>
      ) : null}
    </div>
  )
}
