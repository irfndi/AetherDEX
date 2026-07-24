import { useAppKit } from "@reown/appkit/react"
import { createFileRoute } from "@tanstack/react-router"
import { type FormEvent, useEffect, useMemo, useState } from "react"
import { useAccount } from "wagmi"
import { Card, CardBody, CardTitle } from "../components/ui/Card"
import { Input } from "../components/ui/Input"
import {
  buildRebalanceIntent,
  type RebalanceFormValues,
  type RebalancePosition,
  validateRebalanceForm,
} from "../lib/rebalance"

export const Route = createFileRoute("/positions")({
  component: PositionsPage,
})

const initialValues: RebalanceFormValues = {
  lowerTick: "-1200",
  upperTick: "1200",
  slippage: "0.5",
  deadline: "1800",
}

interface IndexedPosition {
  readonly id: number
  readonly poolId: string
  readonly tickSpacing: number
  readonly tickLower: number
  readonly tickUpper: number
  readonly liquidity: string
}

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:8080/api/v1"

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function isIndexedPosition(value: unknown): value is IndexedPosition {
  if (!isRecord(value)) return false
  const position = value
  return (
    typeof position.id === "number" &&
    typeof position.poolId === "string" &&
    typeof position.tickSpacing === "number" &&
    typeof position.tickLower === "number" &&
    typeof position.tickUpper === "number" &&
    typeof position.liquidity === "string"
  )
}

function isIndexedPositionResponse(value: unknown): value is { readonly positions: readonly IndexedPosition[] } {
  if (!isRecord(value)) return false
  const positions = value.positions
  return Array.isArray(positions) && positions.every(isIndexedPosition)
}

function toRebalancePosition(position: IndexedPosition): RebalancePosition {
  return {
    positionId: `#${position.id}`,
    poolId: position.poolId,
    pair: "Token 0 / Token 1",
    token0: "Token 0",
    token1: "Token 1",
    currentLowerTick: position.tickLower,
    currentUpperTick: position.tickUpper,
    tickSpacing: position.tickSpacing,
    liquidity: position.liquidity,
  }
}

export function selectIndexedPosition(
  positions: readonly IndexedPosition[],
  selectedId: number | null,
): IndexedPosition | null {
  return positions.find((position) => position.id === selectedId) ?? positions[0] ?? null
}

function PositionsPage() {
  const { open } = useAppKit()
  const { address, isConnected } = useAccount()
  const [positions, setPositions] = useState<IndexedPosition[]>([])
  const [isPending, setIsPending] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [selectedPositionId, setSelectedPositionId] = useState<number | null>(null)
  const [values, setValues] = useState<RebalanceFormValues>(initialValues)
  const [submitted, setSubmitted] = useState(false)
  const indexedSelectedPosition = selectIndexedPosition(positions, selectedPositionId)
  const selectedPosition = indexedSelectedPosition ? toRebalancePosition(indexedSelectedPosition) : null
  const validation = useMemo(
    () => validateRebalanceForm(values, selectedPosition?.tickSpacing ?? 60),
    [values, selectedPosition],
  )
  const intent = useMemo(
    () => (validation.valid && selectedPosition ? buildRebalanceIntent(selectedPosition, values) : null),
    [validation.valid, selectedPosition, values],
  )

  useEffect(() => {
    if (!isConnected || !address) {
      setPositions([])
      setSelectedPositionId(null)
      setErrorMessage(null)
      return
    }
    const controller = new AbortController()
    let active = true
    setIsPending(true)
    setErrorMessage(null)
    fetch(`${API_URL}/users/${encodeURIComponent(address)}/positions`, { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        return response.json()
      })
      .then((response: unknown) => {
        if (!isIndexedPositionResponse(response)) throw new Error("Unexpected positions response")
        if (!active) return
        setPositions([...response.positions])
        setSelectedPositionId((current) =>
          response.positions.some((position) => position.id === current)
            ? current
            : (response.positions[0]?.id ?? null),
        )
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return
        if (active) {
          setPositions([])
          setSelectedPositionId(null)
          setErrorMessage(error instanceof Error ? error.message : "Unknown request error")
        }
      })
      .finally(() => {
        if (active) setIsPending(false)
      })
    return () => {
      active = false
      controller.abort()
    }
  }, [address, isConnected])

  const updateValue = (field: keyof RebalanceFormValues, value: string) => {
    setSubmitted(false)
    setValues((current) => ({ ...current, [field]: value }))
  }

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setSubmitted(true)
  }

  if (!isConnected) {
    return (
      <div className="mx-auto max-w-5xl space-y-6 py-6">
        <PageHeading />
        <Card>
          <CardBody className="items-center py-12 text-center">
            <span className="badge badge-primary badge-outline">Wallet required</span>
            <CardTitle className="mt-3">Connect your wallet</CardTitle>
            <p className="max-w-md text-base-content/60">Your indexed positions will appear here after connection.</p>
            <button type="button" className="btn btn-primary mt-2" onClick={() => open()}>
              Connect wallet
            </button>
          </CardBody>
        </Card>
      </div>
    )
  }

  if (isPending) {
    return (
      <div className="mx-auto max-w-5xl space-y-6 py-6">
        <PageHeading />
        <Card>
          <CardBody className="items-center py-12">
            <span className="loading loading-spinner loading-lg text-primary" />
          </CardBody>
        </Card>
      </div>
    )
  }

  if (errorMessage || !selectedPosition) {
    return (
      <div className="mx-auto max-w-5xl space-y-6 py-6">
        <PageHeading />
        <Card>
          <CardBody className="items-center py-12 text-center">
            <CardTitle>{errorMessage ? "Couldn’t load positions" : "No indexed positions yet"}</CardTitle>
            <p className="max-w-md text-sm text-base-content/60">
              {errorMessage
                ? `The positions index returned ${errorMessage}.`
                : "Provide liquidity first, then return here to rebalance it."}
            </p>
          </CardBody>
        </Card>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6 py-6">
      <div>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-3xl font-bold">Positions</h1>
          <span className="badge badge-warning">Indexed position</span>
        </div>
        <p className="mt-2 text-base-content/60">
          Prepare a protected close, collect, and re-mint sequence for a position you control.
        </p>
      </div>

      <Card>
        <CardBody>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-xs uppercase tracking-[0.18em] text-base-content/50">Selected position</p>
              <CardTitle className="mt-1">{selectedPosition.pair}</CardTitle>
              <p className="font-mono text-xs text-base-content/60">
                {selectedPosition.positionId} · {selectedPosition.poolId}
              </p>
            </div>
            <span className="badge badge-success badge-outline">From position index</span>
          </div>
          {positions.length > 1 ? (
            <label className="form-control mt-5 max-w-md">
              <span className="label-text text-xs uppercase tracking-[0.18em] text-base-content/50">Position</span>
              <select
                className="select select-bordered mt-2 w-full font-mono text-sm"
                value={selectedPositionId ?? ""}
                onChange={(event) => setSelectedPositionId(Number(event.target.value))}
              >
                {positions.map((position) => (
                  <option key={position.id} value={position.id}>
                    #{position.id} · {position.tickLower} to {position.tickUpper}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <div className="mt-5 grid gap-4 sm:grid-cols-3">
            <PositionValue
              label="Current range"
              value={`${selectedPosition.currentLowerTick} to ${selectedPosition.currentUpperTick}`}
            />
            <PositionValue label="Liquidity" value={`${selectedPosition.liquidity} ${selectedPosition.token0}`} />
            <PositionValue label="Tick spacing" value={`${selectedPosition.tickSpacing}`} mono />
          </div>
        </CardBody>
      </Card>

      <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
        <Card>
          <CardBody>
            <CardTitle>New range and protection</CardTitle>
            <p className="mb-2 text-sm text-base-content/60">
              Values are collected into an intent only. No calldata is created in this phase.
            </p>
            <form className="space-y-4" onSubmit={handleSubmit}>
              <div className="grid gap-4 sm:grid-cols-2">
                <Input
                  id="rebalance-lower-tick"
                  label="New lower tick"
                  type="number"
                  step={selectedPosition.tickSpacing}
                  value={values.lowerTick}
                  {...inputError(validation.errors.lowerTick)}
                  onChange={(event) => updateValue("lowerTick", event.target.value)}
                />
                <Input
                  id="rebalance-upper-tick"
                  label="New upper tick"
                  type="number"
                  step={selectedPosition.tickSpacing}
                  value={values.upperTick}
                  {...inputError(validation.errors.upperTick)}
                  onChange={(event) => updateValue("upperTick", event.target.value)}
                />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <Input
                  id="rebalance-slippage"
                  label="Max slippage (%)"
                  type="number"
                  min="0"
                  max="5"
                  step="0.1"
                  value={values.slippage}
                  {...inputError(validation.errors.slippage)}
                  onChange={(event) => updateValue("slippage", event.target.value)}
                />
                <Input
                  id="rebalance-deadline"
                  label="Deadline (seconds)"
                  type="number"
                  min="60"
                  max="86400"
                  step="60"
                  value={values.deadline}
                  {...inputError(validation.errors.deadline)}
                  onChange={(event) => updateValue("deadline", event.target.value)}
                />
              </div>
              <button type="submit" className="btn btn-primary w-full" disabled={!validation.valid}>
                Prepare rebalance intent
              </button>
              {submitted && intent ? (
                <p className="text-sm text-warning" role="status">
                  Intent prepared locally. Execution remains unavailable until deployed manager/router configuration
                  exists.
                </p>
              ) : null}
            </form>
          </CardBody>
        </Card>

        <Card>
          <CardBody>
            <div className="flex items-center justify-between gap-3">
              <CardTitle>Execution sequence</CardTitle>
              <span className="badge badge-warning badge-outline">Unavailable</span>
            </div>
            <p className="mt-2 text-sm text-base-content/60">
              The builder preserves ordering and user constraints, but does not submit a transaction.
            </p>
            <ol className="mt-5 space-y-4">
              {[
                ["01", "Close", "Burn the selected position liquidity."],
                ["02", "Collect", "Collect the position tokens and accrued fees."],
                ["03", "Re-mint", "Mint the position using the new tick range."],
              ].map(([number, title, description]) => (
                <li className="flex gap-3" key={number}>
                  <span className="badge badge-primary badge-outline font-mono">{number}</span>
                  <div>
                    <p className="font-medium">{title}</p>
                    <p className="text-sm text-base-content/60">{description}</p>
                  </div>
                </li>
              ))}
            </ol>
            <div className="alert alert-warning mt-6 items-start text-sm">
              <span>
                Execution unavailable until deployed manager/router config exists. A transaction hash or success state
                will not be shown here.
              </span>
            </div>
            {intent ? (
              <div className="mt-4 rounded-box border border-base-300 p-3 text-xs text-base-content/60">
                <p className="font-mono">
                  Range: {intent.newRange.lowerTick} to {intent.newRange.upperTick}
                </p>
                <p className="font-mono">
                  Protection: {intent.slippageBps} bps · {intent.deadlineSeconds}s
                </p>
              </div>
            ) : null}
          </CardBody>
        </Card>
      </div>
    </div>
  )
}

function PageHeading() {
  return (
    <div>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-3xl font-bold">Positions</h1>
        <span className="badge badge-warning">Rebalance</span>
      </div>
      <p className="mt-2 text-base-content/60">
        Prepare a protected close, collect, and re-mint sequence for a position you control.
      </p>
    </div>
  )
}

function PositionValue({
  label,
  value,
  mono = false,
}: {
  readonly label: string
  readonly value: string
  readonly mono?: boolean
}) {
  return (
    <div>
      <p className="text-xs text-base-content/50">{label}</p>
      <p className={mono ? "font-mono text-sm" : "text-sm"}>{value}</p>
    </div>
  )
}

function inputError(error: string | undefined): { readonly error: string } | Record<string, never> {
  return error ? { error } : {}
}
