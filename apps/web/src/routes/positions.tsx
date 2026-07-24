import { createFileRoute } from "@tanstack/react-router"
import { type FormEvent, useMemo, useState } from "react"
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

const selectedPosition: RebalancePosition = {
  positionId: "#1842",
  poolId: "0xpool-eth-usdc",
  pair: "ETH / USDC",
  token0: "ETH",
  token1: "USDC",
  currentLowerTick: -600,
  currentUpperTick: 600,
  tickSpacing: 60,
  liquidity: "12.48",
}

const initialValues: RebalanceFormValues = {
  lowerTick: "-1200",
  upperTick: "1200",
  slippage: "0.5",
  deadline: "1800",
}

function PositionsPage() {
  const [values, setValues] = useState<RebalanceFormValues>(initialValues)
  const [submitted, setSubmitted] = useState(false)
  const validation = useMemo(() => validateRebalanceForm(values, selectedPosition.tickSpacing), [values])
  const intent = useMemo(
    () => (validation.valid ? buildRebalanceIntent(selectedPosition, values) : null),
    [validation.valid, values],
  )

  const updateValue = (field: keyof RebalanceFormValues, value: string) => {
    setSubmitted(false)
    setValues((current) => ({ ...current, [field]: value }))
  }

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setSubmitted(true)
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6 py-6">
      <div>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-3xl font-bold">Positions</h1>
          <span className="badge badge-warning">Rebalance preview</span>
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
            <span className="badge badge-warning badge-outline">Example position</span>
          </div>
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
