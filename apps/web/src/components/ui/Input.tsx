import { type InputHTMLAttributes, useId } from "react"

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string
  error?: string | undefined
}

export function Input({ label, error, className = "", id, ...rest }: InputProps) {
  const generatedId = useId()
  const inputId = id ?? generatedId
  const errorId = error ? `${inputId}-error` : undefined
  const errorClass = error ? "input-error" : ""
  return (
    <div className="min-w-0 w-full">
      {label ? (
        <label className="mb-1.5 block text-sm font-medium text-base-content/80" htmlFor={inputId}>
          {label}
        </label>
      ) : null}
      <input
        id={inputId}
        aria-invalid={error ? true : undefined}
        aria-describedby={errorId}
        className={`input min-w-0 max-w-full w-full ${errorClass} ${className}`.trim()}
        {...rest}
      />
      {error ? (
        <p id={errorId} className="mt-1 text-sm text-error">
          {error}
        </p>
      ) : null}
    </div>
  )
}
