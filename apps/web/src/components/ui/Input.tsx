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
    <div className="form-control min-w-0 w-full">
      {label ? (
        <label className="label min-w-0 max-w-full" htmlFor={inputId}>
          <span className="label-text min-w-0 max-w-full flex-1 whitespace-normal break-words">{label}</span>
        </label>
      ) : null}
      <input
        id={inputId}
        aria-invalid={error ? true : undefined}
        aria-describedby={errorId}
        className={`input input-bordered min-w-0 max-w-full w-full ${errorClass} ${className}`.trim()}
        {...rest}
      />
      {error ? (
        <label className="label" htmlFor={inputId} id={errorId}>
          <span className="label-text-alt text-error">{error}</span>
        </label>
      ) : null}
    </div>
  )
}
