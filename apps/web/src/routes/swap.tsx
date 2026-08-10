import { createFileRoute } from "@tanstack/react-router"
import { AnimatePresence, motion } from "framer-motion"
import { AlertCircle, ArrowDown, CheckCircle2, Settings2 } from "lucide-react"
import { useCallback, useEffect, useRef, useState } from "react"
import { useAccount, useWaitForTransactionReceipt, useWalletClient } from "wagmi"
import { TokenChip } from "../components/TokenChip"
import { type Token, TokenSearch } from "../components/TokenSearch"
import { Button } from "../components/ui/Button"
import { Card, CardBody } from "../components/ui/Card"
import { useSiweAuth } from "../hooks/useSiweAuth"

export const Route = createFileRoute("/swap")({
  component: SwapPage,
})

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

type SwapState = "idle" | "building" | "signing" | "pending" | "success" | "error"

interface RecordSwapPayload {
  txHash: `0x${string}`
  poolId: string
  tokenIn: string
  tokenOut: string
  amountIn: string
  amountOut: string
  blockNumber?: number
  blockTimestamp?: number
  authToken: string
}

const SLIPPAGE_OPTIONS = [0.1, 0.5, 1.0] as const

/**
 * Quotes carry an `expiresAt` (ms epoch) from the API; the swap must be built
 * and signed against a fresh quote, so an expired quote is rejected up front.
 */
export function isQuoteExpired(quote: SwapQuote, now = Date.now()): boolean {
  return quote.expiresAt <= now
}

function SwapPage() {
  const { isConnected, address } = useAccount()
  const { isAuthenticated, signIn, token: authToken, loading: authLoading } = useSiweAuth()

  const [tokenIn, setTokenIn] = useState<Token | null>(null)
  const [tokenOut, setTokenOut] = useState<Token | null>(null)
  const [amountIn, setAmountIn] = useState("")
  const [slippage, setSlippage] = useState(0.5)
  const [quote, setQuote] = useState<SwapQuote | null>(null)
  const [quoteLoading, setQuoteLoading] = useState(false)
  const [quoteError, setQuoteError] = useState<string | null>(null)
  const [quoteNonce, setQuoteNonce] = useState(0)
  const [swapState, setSwapState] = useState<SwapState>("idle")
  const [txHash, setTxHash] = useState<`0x${string}` | undefined>(undefined)
  const [recordError, setRecordError] = useState<string | null>(null)
  const [recordPending, setRecordPending] = useState(false)
  const recordPayloadRef = useRef<RecordSwapPayload | null>(null)

  const { data: walletClient } = useWalletClient()
  const {
    isLoading: isConfirming,
    isSuccess: isConfirmed,
    data: receipt,
  } = useWaitForTransactionReceipt({ hash: txHash })

  const apiUrl = import.meta.env.VITE_API_URL ?? "http://localhost:8080/api/v1"

  // Fetch quote when tokens + amount change (400ms debounce)
  useEffect(() => {
    if (!tokenIn || !tokenOut || !amountIn || Number.parseFloat(amountIn) <= 0) {
      setQuote(null)
      setQuoteError(null)
      return
    }

    let cancelled = false
    setQuoteLoading(true)
    setQuoteError(null)

    const controller = new AbortController()

    const handle = setTimeout(() => {
      const params = new URLSearchParams({
        tokenIn: tokenIn.address,
        tokenOut: tokenOut.address,
        amountIn,
        slippage: slippage.toString(),
      })

      fetch(`${apiUrl}/quote?${params}&nonce=${quoteNonce}`, { signal: controller.signal })
        .then((res) => {
          if (!res.ok) throw new Error(`HTTP ${res.status}`)
          return res.json()
        })
        .then((data: SwapQuote) => {
          if (!cancelled) setQuote(data)
        })
        .catch((err) => {
          if (!cancelled && err.name !== "AbortError") {
            setQuoteError(err instanceof Error ? err.message : String(err))
          }
        })
        .finally(() => {
          if (!cancelled) setQuoteLoading(false)
        })
    }, 400)

    return () => {
      cancelled = true
      controller.abort()
      clearTimeout(handle)
    }
  }, [tokenIn, tokenOut, amountIn, slippage, quoteNonce])

  const handleSwitchTokens = () => {
    const prev = tokenIn
    setTokenIn(tokenOut)
    setTokenOut(prev)
    setAmountIn("")
  }

  const handleSwap = async () => {
    if (!quote || !tokenIn || !tokenOut) return

    if (isQuoteExpired(quote)) {
      setQuoteError("Quote expired \u2014 refreshing\u2026")
      setQuoteNonce((n) => n + 1)
      return
    }

    if (!isConnected || !address) return

    if (!isAuthenticated) {
      await signIn()
      return
    }

    setSwapState("building")
    setQuoteError(null)
    try {
      const buildRes = await fetch(`${apiUrl}/build`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ quote, recipient: address }),
      })
      if (!buildRes.ok) throw new Error("Failed to build swap calldata")
      const calldata = (await buildRes.json()) as { to: string; data: string; value: string }

      if (!/^0x[a-fA-F0-9]{40}$/.test(calldata.to)) {
        throw new Error(`Invalid router address from API: ${calldata.to}`)
      }
      if (!walletClient) throw new Error("Wallet client is not ready")
      setSwapState("signing")
      const hash = await walletClient.sendTransaction({
        account: address,
        to: calldata.to as `0x${string}`,
        data: calldata.data as `0x${string}`,
        value: BigInt(calldata.value || "0"),
      })
      setTxHash(hash)
      setSwapState("pending")
    } catch (err) {
      setSwapState("error")
      setQuoteError(err instanceof Error ? err.message : String(err))
    }
  }

  /**
   * POST the confirmed swap to the indexer. Failures are surfaced as a
   * visible banner with a manual retry instead of a silent `.catch(console.error)`.
   */
  const recordSwap = useCallback(async () => {
    const payload = recordPayloadRef.current
    if (!payload) return

    setRecordPending(true)
    setRecordError(null)
    try {
      const res = await fetch(`${apiUrl}/record`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${payload.authToken}`,
        },
        body: JSON.stringify({
          txHash: payload.txHash,
          poolId: payload.poolId,
          tokenIn: payload.tokenIn,
          tokenOut: payload.tokenOut,
          amountIn: payload.amountIn,
          amountOut: payload.amountOut,
          blockNumber: payload.blockNumber,
          blockTimestamp: payload.blockTimestamp,
        }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
    } catch {
      setRecordError("Swap confirmed, but index sync failed \u2014 retry to update your portfolio")
    } finally {
      setRecordPending(false)
    }
  }, [])

  useEffect(() => {
    if (!(isConfirmed && swapState === "pending" && txHash && quote && tokenIn && tokenOut)) return

    setSwapState("success")

    if (authToken) {
      recordPayloadRef.current = {
        txHash,
        poolId: quote.poolId,
        tokenIn: tokenIn.address,
        tokenOut: tokenOut.address,
        amountIn: quote.amountIn,
        amountOut: quote.amountOut,
        ...(receipt?.blockNumber ? { blockNumber: Number(receipt.blockNumber) } : {}),
        ...(receipt?.blockTimestamp ? { blockTimestamp: Number(receipt.blockTimestamp) } : {}),
        authToken,
      }
      recordSwap()
    }

    const timer = setTimeout(() => {
      setSwapState("idle")
      setAmountIn("")
      // Keep txHash + record payload so a failed /record stays retryable.
    }, 3000)

    return () => clearTimeout(timer)
  }, [isConfirmed, swapState, txHash, quote, tokenIn, tokenOut, authToken, receipt, recordSwap])

  const isQuoteValid = quote !== null && quoteError === null && !quoteLoading
  const needsAuth = isConnected && !isAuthenticated

  const swapButtonLabel = (() => {
    if (swapState === "building") return "Building transaction\u2026"
    if (swapState === "signing") return "Confirm in wallet\u2026"
    if (swapState === "pending") return "Waiting for confirmation\u2026"
    if (swapState === "success") {
      return (
        <span className="flex items-center gap-2">
          <CheckCircle2 className="h-4 w-4" />
          Swap Confirmed
        </span>
      )
    }
    if (swapState === "error") return "Swap failed \u2014 try again"
    if (quoteLoading) return "Fetching quote\u2026"
    return `Swap ${tokenIn?.symbol ?? "?"} \u2192 ${tokenOut?.symbol ?? "?"}`
  })()

  return (
    <div className="mx-auto max-w-md py-8 px-4">
      <Card>
        <CardBody>
          <div className="flex flex-col gap-4">
            {/* Header */}
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-bold">Swap</h2>
              <div className="dropdown dropdown-end">
                <button type="button" tabIndex={0} className="btn btn-ghost btn-sm btn-circle" aria-label="Settings">
                  <Settings2 className="h-4 w-4" />
                </button>
                {/* biome-ignore lint/a11y/noNoninteractiveTabindex: DaisyUI dropdown requires tabIndex for keyboard navigation */}
                <ul tabIndex={0} className="dropdown-content menu bg-base-200 rounded-box z-10 w-56 p-2 shadow">
                  <li className="menu-title">Slippage tolerance</li>
                  {SLIPPAGE_OPTIONS.map((s) => (
                    <li key={s}>
                      <button type="button" onClick={() => setSlippage(s)} className={slippage === s ? "active" : ""}>
                        {s.toFixed(1)}%
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            {/* Token In */}
            <div className="rounded-xl bg-base-300 p-4">
              <div className="mb-1 flex items-center justify-between text-xs text-base-content/60">
                <span>You pay</span>
                {/* Balance: T29 */}
                <span>Balance: 0.0</span>
              </div>
              <div className="flex items-center gap-3">
                <input
                  type="text"
                  inputMode="decimal"
                  placeholder="0.0"
                  value={amountIn}
                  onChange={(e) => setAmountIn(e.target.value.replace(/[^0-9.]/g, ""))}
                  className="input flex-1 border-0 bg-transparent text-3xl font-medium focus:outline-none"
                />
                <TokenSearch onSelect={setTokenIn} selectedToken={tokenIn} placeholder="Search token" />
              </div>
              {tokenIn && (
                <div className="mt-2">
                  <TokenChip token={tokenIn} />
                </div>
              )}
            </div>

            {/* Switch button */}
            <div className="-my-2 flex justify-center">
              <motion.button
                type="button"
                onClick={handleSwitchTokens}
                disabled={!tokenIn || !tokenOut}
                className="btn btn-circle btn-sm btn-ghost"
                aria-label="Switch tokens"
                whileTap={{ scale: 0.9 }}
              >
                <motion.div animate={{ rotate: tokenIn && tokenOut ? 180 : 0 }} transition={{ duration: 0.3 }}>
                  <ArrowDown className="h-4 w-4" />
                </motion.div>
              </motion.button>
            </div>

            {/* Token Out */}
            <div className="rounded-xl bg-base-300 p-4">
              <div className="mb-1 flex items-center justify-between text-xs text-base-content/60">
                <span>You receive</span>
                {/* Balance: T29 */}
                <span>Balance: 0.0</span>
              </div>
              <div className="flex items-center gap-3">
                <div className="flex-1 text-3xl font-medium">
                  {quoteLoading ? (
                    <span className="loading loading-dots loading-sm text-base-content/40" />
                  ) : quote && tokenOut ? (
                    formatAmount(quote.amountOut, tokenOut.decimals)
                  ) : (
                    <span className="text-base-content/40">0.0</span>
                  )}
                </div>
                <TokenSearch onSelect={setTokenOut} selectedToken={tokenOut} placeholder="Search token" />
              </div>
              {tokenOut && (
                <div className="mt-2">
                  <TokenChip token={tokenOut} />
                </div>
              )}
            </div>

            {/* Quote details */}
            <AnimatePresence>
              {isQuoteValid && quote && tokenIn && tokenOut ? (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  className="overflow-hidden rounded-xl bg-base-300 p-3 text-sm"
                >
                  <div className="space-y-1">
                    <div className="flex justify-between">
                      <span className="text-base-content/60">Rate</span>
                      <span>
                        1 {tokenIn.symbol} ={" "}
                        {formatRate(quote.amountIn, quote.amountOut, tokenIn.decimals, tokenOut.decimals)}{" "}
                        {tokenOut.symbol}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-base-content/60">Price impact</span>
                      <span className={quote.priceImpact > 0.05 ? "text-warning" : ""}>
                        {(quote.priceImpact * 100).toFixed(2)}%
                      </span>
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
                </motion.div>
              ) : null}
            </AnimatePresence>

            {/* Error */}
            {quoteError && (
              <div className="alert alert-error text-sm">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span>{quoteError}</span>
              </div>
            )}

            {/* Action button */}
            {!isConnected ? (
              <Button variant="primary" size="lg" fullWidth>
                Connect Wallet
              </Button>
            ) : needsAuth ? (
              <Button variant="primary" size="lg" fullWidth onClick={() => signIn()} loading={authLoading}>
                Sign In to AetherDEX
              </Button>
            ) : (
              <Button
                variant="primary"
                size="lg"
                fullWidth
                onClick={() => handleSwap()}
                disabled={
                  !isQuoteValid ||
                  swapState === "building" ||
                  swapState === "signing" ||
                  swapState === "pending" ||
                  isConfirming
                }
                loading={swapState === "building" || swapState === "signing" || swapState === "pending" || isConfirming}
              >
                {swapButtonLabel}
              </Button>
            )}
            {/* Index sync failure — retryable */}
            {recordError && (
              <div className="alert alert-warning text-sm">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span className="flex-1">{recordError}</span>
                <Button variant="primary" size="sm" onClick={() => recordSwap()} loading={recordPending}>
                  Retry
                </Button>
              </div>
            )}
          </div>
        </CardBody>
      </Card>
    </div>
  )
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
function formatRate(amountIn: string, amountOut: string, decIn: number, decOut: number): string {
  try {
    const a = Number(BigInt(amountIn))
    const b = Number(BigInt(amountOut))
    if (a === 0) return "0"

    // Normalize to same decimal base
    const rate = (b * 10 ** decIn) / (a * 10 ** decOut)
    return rate.toFixed(6)
  } catch {
    return "\u2014"
  }
}
