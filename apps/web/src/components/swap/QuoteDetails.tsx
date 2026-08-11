import { formatAmount, formatRate, type SwapQuote } from "../../lib/swap"
import type { Token } from "../TokenSearch"

interface QuoteDetailsProps {
  quote: SwapQuote
  tokenIn: Token
  tokenOut: Token
}

export function QuoteDetails({ quote, tokenIn, tokenOut }: QuoteDetailsProps) {
  return (
    <div className="space-y-1">
      <div className="flex justify-between">
        <span className="text-base-content/60">Rate</span>
        <span>
          1 {tokenIn.symbol} = {formatRate(quote.amountIn, quote.amountOut, tokenIn.decimals, tokenOut.decimals)}{" "}
          {tokenOut.symbol}
        </span>
      </div>
      <div className="flex justify-between">
        <span className="text-base-content/60">Price impact</span>
        <span className={quote.priceImpact > 0.05 ? "text-signal" : ""}>{(quote.priceImpact * 100).toFixed(2)}%</span>
      </div>
      <div className="flex justify-between">
        <span className="text-base-content/60">Pool fee (to LPs)</span>
        <span>{(quote.fee / 10_000).toFixed(2)}%</span>
      </div>
      <div className="flex justify-between">
        <span className="text-base-content/60">Protocol fee</span>
        <span className="text-success">Free · 0%</span>
      </div>
      <div className="flex justify-between">
        <span className="text-base-content/60">Min received</span>
        <span>
          {formatAmount(quote.minAmountOut, tokenOut.decimals)} {tokenOut.symbol}
        </span>
      </div>
      <div className="flex justify-between">
        <span className="text-base-content/60">Network fee</span>
        <span>~{quote.gasEstimate}</span>
      </div>
    </div>
  )
}
