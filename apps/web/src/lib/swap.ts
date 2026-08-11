export interface SwapQuote {
  poolId: string
  tokenIn: string
  tokenOut: string
  amountIn: string
  amountOut: string
  minAmountOut: string
  priceImpact: number
  fee: number
  gasEstimate: string
  expiresAt: number
}

/**
 * Format a raw bigint string (smallest unit) to a human-readable decimal.
 * Fractions are trimmed of trailing zeros, capped at 6 digits, and padded
 * to at least 2 digits so short values do not overflow the fixed-width card.
 */
export function formatAmount(raw: string, decimals: number): string {
  try {
    const negative = raw.startsWith("-")
    const digits = negative ? raw.slice(1) : raw

    if (decimals === 0) return `${negative ? "-" : ""}${digits}`

    const padded = digits.padStart(decimals + 1, "0")
    const intPart = padded.slice(0, padded.length - decimals)
    const fracPart = padded.slice(padded.length - decimals)

    const trimmed = fracPart.replace(/0+$/, "").slice(0, 6)
    const displayFrac = (trimmed || "0").padEnd(2, "0")

    return `${negative ? "-" : ""}${intPart}.${displayFrac}`
  } catch {
    return raw
  }
}

/**
 * Compute exchange rate from two raw amounts.
 */
export function formatRate(amountIn: string, amountOut: string, decIn: number, decOut: number): string {
  try {
    const a = Number(BigInt(amountIn))
    const b = Number(BigInt(amountOut))
    if (a === 0) return "0"

    // Normalize to same decimal base
    const rate = (b * 10 ** decIn) / (a * 10 ** decOut)
    return rate.toFixed(6)
  } catch {
    return "—"
  }
}
