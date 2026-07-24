import { useAppKit } from "@reown/appkit/react"
import { createFileRoute } from "@tanstack/react-router"
import { useEffect, useState } from "react"
import { useAccount } from "wagmi"
import { Button, Card, CardBody, CardTitle } from "../components/ui"

export const Route = createFileRoute("/portfolio")({
  component: PortfolioPage,
})

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:8080/api/v1"

export interface PortfolioPosition {
  id: number
  poolId: string
  tickLower: number
  tickUpper: number
  liquidity: string
  amount0: string
  amount1: string
  feesEarnedToken0: string
  feesEarnedToken1: string
}

type PortfolioState = "disconnected" | "loading" | "error" | "empty" | "ready"

export function getPortfolioStatus(input: {
  isConnected: boolean
  isPending: boolean
  isError: boolean
  positionCount: number
}): PortfolioState {
  if (!input.isConnected) return "disconnected"
  if (input.isPending) return "loading"
  if (input.isError) return "error"
  if (input.positionCount === 0) return "empty"
  return "ready"
}

export function formatPositionValue(value: string): string {
  return value.trim() === "" ? "Not reported" : value
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function isPortfolioPosition(value: unknown): value is PortfolioPosition {
  return (
    isRecord(value) &&
    typeof value.id === "number" &&
    typeof value.poolId === "string" &&
    typeof value.tickLower === "number" &&
    typeof value.tickUpper === "number" &&
    typeof value.liquidity === "string" &&
    typeof value.amount0 === "string" &&
    typeof value.amount1 === "string" &&
    typeof value.feesEarnedToken0 === "string" &&
    typeof value.feesEarnedToken1 === "string"
  )
}

function isPortfolioResponse(value: unknown): value is { positions: PortfolioPosition[] } {
  if (!isRecord(value)) return false
  const positions = value.positions
  return Array.isArray(positions) && positions.every(isPortfolioPosition)
}

function PortfolioPage() {
  const { open } = useAppKit()
  const { address, isConnected } = useAccount()
  const [positions, setPositions] = useState<PortfolioPosition[]>([])
  const [isPending, setIsPending] = useState(false)
  const [isError, setIsError] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    if (!isConnected || !address) {
      setPositions([])
      setIsPending(false)
      setIsError(false)
      setErrorMessage(null)
      return
    }

    const controller = new AbortController()
    setIsPending(true)
    setIsError(false)
    setErrorMessage(null)

    fetch(`${API_URL}/users/${encodeURIComponent(address)}/positions?refresh=${reloadKey}`, {
      signal: controller.signal,
    })
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        return response.json()
      })
      .then((response) => {
        if (!isPortfolioResponse(response)) throw new Error("Unexpected positions response")
        setPositions(response.positions)
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return
        setPositions([])
        setIsError(true)
        setErrorMessage(error instanceof Error ? error.message : "Unknown request error")
      })
      .finally(() => setIsPending(false))

    return () => controller.abort()
  }, [address, isConnected, reloadKey])

  return (
    <div className="mx-auto max-w-6xl py-8">
      <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm font-medium text-primary">Liquidity overview</p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight">Portfolio</h1>
          <p className="mt-2 max-w-2xl text-base-content/60">
            Your active concentrated-liquidity positions, sourced from the AetherDEX index.
          </p>
        </div>
        {isConnected ? (
          <Button type="button" variant="outline" size="sm" onClick={() => setReloadKey((key) => key + 1)}>
            Refresh positions
          </Button>
        ) : null}
      </div>

      <PortfolioResults
        errorMessage={errorMessage}
        isConnected={isConnected}
        isError={isError}
        isPending={isPending}
        onConnect={() => open()}
        onRetry={() => setReloadKey((key) => key + 1)}
        positions={positions}
      />
    </div>
  )
}

interface PortfolioResultsProps {
  errorMessage: string | null
  isConnected: boolean
  isError: boolean
  isPending: boolean
  onConnect: () => void
  onRetry: () => void
  positions: readonly PortfolioPosition[]
}

export function PortfolioResults({
  errorMessage,
  isConnected,
  isError,
  isPending,
  onConnect,
  onRetry,
  positions,
}: PortfolioResultsProps) {
  const status = getPortfolioStatus({ isConnected, isPending, isError, positionCount: positions.length })

  if (status === "disconnected") {
    return (
      <Card>
        <CardBody className="items-center py-12 text-center">
          <span className="badge badge-primary badge-outline">Wallet required</span>
          <CardTitle className="mt-3">Connect your wallet</CardTitle>
          <p className="max-w-md text-base-content/60">
            Connect the wallet that owns your liquidity positions to load your portfolio.
          </p>
          <Button type="button" className="mt-2" onClick={onConnect}>
            Open wallet
          </Button>
        </CardBody>
      </Card>
    )
  }

  if (status === "loading") {
    return (
      <Card>
        <CardBody className="items-center py-12 text-center">
          <span className="loading loading-spinner loading-lg text-primary" />
          <p className="mt-3 text-base-content/60">Loading active positions…</p>
        </CardBody>
      </Card>
    )
  }

  if (status === "error") {
    return (
      <Card>
        <CardBody className="items-center py-12 text-center">
          <p className="font-medium">Couldn’t load your positions.</p>
          <p className="mt-1 text-sm text-base-content/60">
            {errorMessage ? `The index returned ${errorMessage}.` : "The positions index is temporarily unavailable."}
          </p>
          <Button type="button" variant="outline" size="sm" className="mt-3" onClick={onRetry}>
            Retry
          </Button>
        </CardBody>
      </Card>
    )
  }

  if (status === "empty") {
    return (
      <Card>
        <CardBody className="items-center py-12 text-center">
          <CardTitle>No active positions yet</CardTitle>
          <p className="max-w-md text-base-content/60">
            Once you provide liquidity, your indexed positions will appear here.
          </p>
        </CardBody>
      </Card>
    )
  }

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      {positions.map((position) => (
        <PositionCard key={position.id} position={position} />
      ))}
    </div>
  )
}

function PositionCard({ position }: { position: PortfolioPosition }) {
  return (
    <Card>
      <CardBody>
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-xs font-medium uppercase tracking-wide text-base-content/60">Pool</p>
            <h2 className="mt-1 truncate font-mono text-sm" title={position.poolId}>
              {position.poolId}
            </h2>
          </div>
          <span className="badge badge-success badge-outline shrink-0">Active</span>
        </div>

        <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
          <PositionMetric label="Tick range" value={`${position.tickLower} to ${position.tickUpper}`} />
          <PositionMetric label="Liquidity" value={formatPositionValue(position.liquidity)} />
          <PositionMetric label="Token 0 amount · raw units" value={formatPositionValue(position.amount0)} />
          <PositionMetric label="Token 1 amount · raw units" value={formatPositionValue(position.amount1)} />
        </div>

        <div className="mt-6 border-t border-base-300 pt-4">
          <p className="text-xs font-medium uppercase tracking-wide text-base-content/60">Earned fees · raw units</p>
          <div className="mt-2 flex flex-wrap gap-x-6 gap-y-2 text-sm">
            <span>Token 0: {formatPositionValue(position.feesEarnedToken0)}</span>
            <span>Token 1: {formatPositionValue(position.feesEarnedToken1)}</span>
          </div>
        </div>

        <div className="mt-4 rounded-box bg-base-300/50 p-3">
          <p className="text-xs font-medium uppercase tracking-wide text-base-content/60">PnL / profit</p>
          <p className="mt-1 text-sm font-medium">Awaiting indexed cost basis</p>
          <p className="mt-1 text-xs text-base-content/60">
            Profit is not calculated until the index has cost-basis history for this position.
          </p>
        </div>
      </CardBody>
    </Card>
  )
}

function PositionMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="text-xs text-base-content/60">{label}</p>
      <p className="mt-1 break-words font-mono text-sm">{value}</p>
    </div>
  )
}
