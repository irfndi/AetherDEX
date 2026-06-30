import type { HTMLAttributes, ReactNode } from "react"

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode
  variant?: "default" | "compact" | "bordered"
  bordered?: boolean
}

export function Card({ children, className = "", variant = "default", bordered = true, ...rest }: CardProps) {
  const base = "card bg-base-200"
  const border = bordered ? "border border-base-300" : ""
  const compact = variant === "compact" ? "card-compact" : ""
  return (
    <div className={`${base} ${border} ${compact} ${className}`.trim()} {...rest}>
      {children}
    </div>
  )
}

interface CardBodyProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode
}

export function CardBody({ children, className = "", ...rest }: CardBodyProps) {
  return (
    <div className={`card-body ${className}`.trim()} {...rest}>
      {children}
    </div>
  )
}

interface CardTitleProps extends HTMLAttributes<HTMLHeadingElement> {
  children: ReactNode
}

export function CardTitle({ children, className = "", ...rest }: CardTitleProps) {
  return (
    <h2 className={`card-title ${className}`.trim()} {...rest}>
      {children}
    </h2>
  )
}

interface CardActionsProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode
}

export function CardActions({ children, className = "", ...rest }: CardActionsProps) {
  return (
    <div className={`card-actions justify-end ${className}`.trim()} {...rest}>
      {children}
    </div>
  )
}
