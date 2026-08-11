import { createFileRoute } from "@tanstack/react-router"
import { AnimatePresence, motion } from "framer-motion"
import { AlertCircle, ArrowDown, CheckCircle2, Settings2 } from "lucide-react"
import { useCallback, useEffect, useRef, useState } from "react"
import { useAccount, usePublicClient, useWaitForTransactionReceipt, useWalletClient } from "wagmi"
import { QuoteDetails } from "../components/swap/QuoteDetails"
import { SwapAmountField } from "../components/swap/SwapAmountField"
import type { Token } from "../components/TokenSearch"
import { Button } from "../components/ui/Button"
import { Card, CardBody } from "../components/ui/Card"
import { useSiweAuth } from "../hooks/useSiweAuth"
import { formatAmount, type SwapQuote } from "../lib/swap"

export const Route = createFileRoute("/swap")({
  component: SwapPage,
})

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

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:8080/api/v1"

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
  const publicClient = usePublicClient()
  const {
    isLoading: isConfirming,
    isSuccess: isConfirmed,
    data: receipt,
  } = useWaitForTransactionReceipt({ hash: txHash })

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

      fetch(`${API_URL}/quote?${params}&nonce=${quoteNonce}`, { signal: controller.signal })
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
      setQuoteError("Quote expired — refreshing…")
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
      const buildRes = await fetch(`${API_URL}/build`, {
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
      const res = await fetch(`${API_URL}/record`, {
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
      setRecordError("Swap confirmed, but index sync failed — retry to update your portfolio")
    } finally {
      setRecordPending(false)
    }
  }, [])

  useEffect(() => {
    if (!(isConfirmed && swapState === "pending" && txHash && quote && tokenIn && tokenOut)) return

    setSwapState("success")

    if (authToken) {
      const blockNumber = receipt?.blockNumber ? Number(receipt.blockNumber) : undefined
      // viem's TransactionReceipt has no blockTimestamp — fetch it from the chain.
      const fetchTimestamp = async () => {
        let blockTimestamp: number | undefined
        if (blockNumber && publicClient) {
          try {
            const block = await publicClient.getBlock({ blockNumber: BigInt(blockNumber) })
            blockTimestamp = Number(block.timestamp)
          } catch {
            blockTimestamp = Math.floor(Date.now() / 1000)
          }
        }
        recordPayloadRef.current = {
          txHash,
          poolId: quote.poolId,
          tokenIn: tokenIn.address,
          tokenOut: tokenOut.address,
          amountIn: quote.amountIn,
          amountOut: quote.amountOut,
          ...(blockNumber ? { blockNumber } : {}),
          ...(blockTimestamp ? { blockTimestamp } : {}),
          authToken,
        }
        recordSwap()
      }
      void fetchTimestamp()
    }

    const timer = setTimeout(() => {
      setSwapState("idle")
      setAmountIn("")
      // Keep txHash + record payload so a failed /record stays retryable.
    }, 3000)

    return () => clearTimeout(timer)
  }, [isConfirmed, swapState, txHash, quote, tokenIn, tokenOut, authToken, receipt, publicClient, recordSwap])

  const isQuoteValid = quote !== null && quoteError === null && !quoteLoading
  const needsAuth = isConnected && !isAuthenticated

  const swapButtonLabel = (() => {
    if (swapState === "building") return "Building transaction…"
    if (swapState === "signing") return "Confirm in wallet…"
    if (swapState === "pending") return "Waiting for confirmation…"
    if (swapState === "success") {
      return (
        <span className="flex items-center gap-2">
          <CheckCircle2 className="size-4" />
          Swap Confirmed
        </span>
      )
    }
    if (swapState === "error") return "Swap failed — try again"
    if (quoteLoading) return "Fetching quote…"
    return `Swap ${tokenIn?.symbol ?? "?"} → ${tokenOut?.symbol ?? "?"}`
  })()

  return (
    <div className="mx-auto max-w-md py-10 px-4">
      <Card className="contour relative overflow-hidden">
        <CardBody>
          <div className="flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <h2 className="font-display text-xl font-medium tracking-tight text-base-content">Swap</h2>
              <div className="dropdown dropdown-end">
                <button type="button" tabIndex={0} className="btn btn-ghost btn-sm btn-circle" aria-label="Settings">
                  <Settings2 className="size-4" />
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

            <SwapAmountField
              label="You pay"
              value={amountIn}
              onChange={setAmountIn}
              token={tokenIn}
              onTokenChange={setTokenIn}
              placeholder="0.0"
            />

            <div className="-my-2 flex justify-center">
              <motion.button
                type="button"
                onClick={handleSwitchTokens}
                disabled={!tokenIn || !tokenOut}
                className="btn btn-circle btn-sm btn-ghost"
                aria-label="Switch tokens"
                whileTap={{ scale: 0.9 }}
              >
                <motion.span
                  animate={tokenIn && tokenOut ? { rotate: 180 } : { rotate: 0 }}
                  transition={{ duration: 0.3 }}
                  className="flex"
                >
                  <ArrowDown className="size-4" />
                </motion.span>
              </motion.button>
            </div>

            <SwapAmountField
              label="You receive"
              value={
                quoteLoading ? "\u00A0" : quote && tokenOut ? formatAmount(quote.amountOut, tokenOut.decimals) : "0.0"
              }
              onChange={() => {}}
              token={tokenOut}
              onTokenChange={setTokenOut}
              placeholder="0.0"
              readOnly
            />

            <AnimatePresence initial={false}>
              {isQuoteValid && quote && tokenIn && tokenOut ? (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.15 }}
                  className="overflow-hidden rounded-xl border hairline bg-base-200/70 p-3 text-sm"
                >
                  <QuoteDetails quote={quote} tokenIn={tokenIn} tokenOut={tokenOut} />
                </motion.div>
              ) : null}
            </AnimatePresence>

            {quoteError ? (
              <div className="alert alert-error text-sm">
                <AlertCircle className="size-4 shrink-0" />
                <span>{quoteError}</span>
              </div>
            ) : null}

            {!isConnected ? (
              <Button variant="primary" size="lg" fullWidth>
                Connect Wallet
              </Button>
            ) : needsAuth ? (
              <Button variant="primary" size="lg" fullWidth onClick={() => signIn()} loading={authLoading}>
                Sign In to Aether
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
            {recordError ? (
              <div className="alert alert-warning text-sm">
                <AlertCircle className="size-4 shrink-0" />
                <span className="flex-1">{recordError}</span>
                <Button variant="primary" size="sm" onClick={() => recordSwap()} loading={recordPending}>
                  Retry
                </Button>
              </div>
            ) : null}
          </div>
        </CardBody>
      </Card>
    </div>
  )
}
