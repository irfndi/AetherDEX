import type { Pool } from "@aetherdex/shared"
import { useQuery } from "@tanstack/react-query"
import { createFileRoute } from "@tanstack/react-router"
import { useEffect, useMemo, useState } from "react"
import { Card, CardBody, CardTitle, Input } from "../components/ui"
import { allocatePositionAmounts, type PriceScenario, priceFromTick, simulatePriceScenarios } from "../lib/playground"
import { poolsQueryOptions } from "../lib/pools-query"

export const Route = createFileRoute("/playground")({
  component: PlaygroundPage,
})

const SCENARIO_MOVES_PERCENT = [-50, -25, -10, -5, 0, 5, 10, 25, 50] as const

const RANGE_PRESETS = [
  { label: "±5%", spread: 0.05 },
  { label: "±10%", spread: 0.1 },
  { label: "±25%", spread: 0.25 },
  { label: "±50%", spread: 0.5 },
] as const

/**
 * Deterministic sample pools used when the API is unreachable so the paper
 * simulator stays usable offline. Prices are derived from `currentTick` (see
 * `poolPaperPrice`), matching how live pools are priced on this page.
 */
const FALLBACK_POOLS: readonly Pool[] = [
  {
    poolId: "0xa100000000000000000000000000000000000000000000000000000000000001",
    token0Address: "0x1111111111111111111111111111111111111111",
    token1Address: "0x2222222222222222222222222222222222222222",
    fee: 3000,
    tickSpacing: 60,
    hookAddress: null,
    sqrtPriceX96: "79228162514264337593543950336",
    currentTick: 76020, // price ≈ 2000
    liquidity: "11843171588960272209",
    tvlUsd: 4_210_000,
    volume24hUsd: 8_115_000,
    fees24hUsd: 24_345,
    isActive: true,
    createdAt: 1_751_328_000,
    updatedAt: 1_753_660_000,
  },
  {
    poolId: "0xb200000000000000000000000000000000000000000000000000000000000002",
    token0Address: "0x3333333333333333333333333333333333333333",
    token1Address: "0x1111111111111111111111111111111111111111",
    fee: 500,
    tickSpacing: 10,
    hookAddress: null,
    sqrtPriceX96: "79228162514264337593543950336",
    currentTick: -69090, // price ≈ 0.001
    liquidity: "410522021674177519",
    tvlUsd: 1_190_000,
    volume24hUsd: 2_480_000,
    fees24hUsd: 1_240,
    isActive: true,
    createdAt: 1_751_414_400,
    updatedAt: 1_753_660_000,
  },
  {
    poolId: "0xc300000000000000000000000000000000000000000000000000000000000003",
    token0Address: "0x4444444444444444444444444444444444444444",
    token1Address: "0x2222222222222222222222222222222222222222",
    fee: 10_000,
    tickSpacing: 200,
    hookAddress: null,
    sqrtPriceX96: "79228162514264337593543950336",
    currentTick: 0, // price = 1
    liquidity: "7611967122042683",
    tvlUsd: 312_000,
    volume24hUsd: 156_000,
    fees24hUsd: 156,
    isActive: true,
    createdAt: 1_751_500_800,
    updatedAt: 1_753_660_000,
  },
]

const DEFAULT_BUDGET = "1000"

/**
 * Paper price for a pool: derived from the tick, which assumes equal token
 * decimals (a documented simplification, fine for paper trading).
 */
function poolPaperPrice(pool: Pool): number {
  return priceFromTick(pool.currentTick)
}

function formatPrice(value: number): string {
  if (!Number.isFinite(value)) return "—"
  if (value >= 1000) return value.toLocaleString("en-US", { maximumFractionDigits: 2 })
  if (value >= 1) return value.toLocaleString("en-US", { maximumFractionDigits: 4 })
  return value.toLocaleString("en-US", { maximumFractionDigits: 6 })
}

function formatAmount(value: number): string {
  if (!Number.isFinite(value)) return "—"
  return value.toLocaleString("en-US", { maximumFractionDigits: 6 })
}

function poolLabel(pool: Pool): string {
  return `Pool ${pool.poolId.slice(0, 6)}…${pool.poolId.slice(-4)} · fee ${(pool.fee / 10_000).toFixed(2)}%`
}

function PlaygroundPage() {
  const query = useQuery({ ...poolsQueryOptions(50, 0, { sortBy: "tvl", sortDirection: "desc" }), retry: 1 })
  const apiFailed = query.isError || (!query.isPending && (query.data?.pools.length ?? 0) === 0)
  const pools = query.isPending || apiFailed ? FALLBACK_POOLS : (query.data?.pools ?? FALLBACK_POOLS)

  const [selectedPoolId, setSelectedPoolId] = useState<string | null>(null)
  const selectedPool = pools.find((pool) => pool.poolId === selectedPoolId) ?? (pools[0] as Pool | undefined)

  const [budget, setBudget] = useState(DEFAULT_BUDGET)
  const [lowerText, setLowerText] = useState("")
  const [upperText, setUpperText] = useState("")

  // Re-seed the price bounds whenever the paper pool changes, keeping the
  // default ±25% range centered on that pool's derived price.
  useEffect(() => {
    if (!selectedPool) return
    const price = poolPaperPrice(selectedPool)
    setLowerText(formatAmount(price * 0.75))
    setUpperText(formatAmount(price * 1.25))
  }, [selectedPool])

  const currentPrice = selectedPool ? poolPaperPrice(selectedPool) : 0
  const lowerPrice = Number(lowerText)
  const upperPrice = Number(upperText)
  const amountUsdOrToken = Number(budget)
  const feePercent = selectedPool ? selectedPool.fee / 10_000 : undefined

  const allocation = useMemo(
    () => allocatePositionAmounts({ amountUsdOrToken, currentPrice, lowerPrice, upperPrice }),
    [amountUsdOrToken, currentPrice, lowerPrice, upperPrice],
  )

  const scenarios = useMemo(() => {
    if (!allocation.ok) return null
    const result = simulatePriceScenarios({
      currentPrice,
      lowerPrice,
      upperPrice,
      amount0: allocation.amount0,
      amount1: allocation.amount1,
      priceChangesPercent: SCENARIO_MOVES_PERCENT,
      feePercent,
    })
    return result.ok ? result : null
  }, [allocation, currentPrice, lowerPrice, upperPrice, feePercent])

  const applyPreset = (spread: number) => {
    setLowerText(formatAmount(currentPrice * (1 - spread)))
    setUpperText(formatAmount(currentPrice * (1 + spread)))
  }

  const rangeErrors = allocation.ok ? {} : allocation.errors

  return (
    <div className="mx-auto max-w-6xl py-8">
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <h1 className="text-3xl font-bold">LP Playground</h1>
        <span className="badge badge-warning badge-outline font-semibold">Paper trading</span>
      </div>
      <p className="mb-4 max-w-3xl text-sm text-base-content/60">
        Simulate a concentrated-liquidity position without connecting a wallet. Pick a pool, set a price range, and see
        how the position would split and re-value under price moves. Nothing here touches real funds.
      </p>

      <div className="alert alert-info mb-6 py-3 text-sm" role="note">
        <span>
          <strong>Simulation only.</strong> Prices are derived from pool ticks assuming equal token decimals, and
          scenario values use a simple basket model — not full concentrated-liquidity math. Treat every number as an
          illustration.
        </span>
      </div>

      {query.isPending ? (
        <div className="mb-6 flex items-center justify-center gap-3 py-4" role="status" aria-label="Loading pools">
          <span className="loading loading-spinner loading-md text-primary" aria-hidden="true" />
          <span className="text-sm text-base-content/60">Loading pools…</span>
        </div>
      ) : null}

      {apiFailed ? (
        <div className="alert alert-warning mb-6 py-3 text-sm" role="note">
          <span>Live pool data is unavailable — showing bundled sample pools instead.</span>
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardBody>
              <CardTitle className="mb-2">Position setup</CardTitle>

              <div className="form-control w-full">
                <label className="label" htmlFor="playground-pool">
                  <span className="label-text">Paper pool</span>
                </label>
                <select
                  id="playground-pool"
                  className="select select-bordered w-full"
                  value={selectedPool?.poolId ?? ""}
                  onChange={(e) => setSelectedPoolId(e.target.value)}
                >
                  {pools.map((pool) => (
                    <option key={pool.poolId} value={pool.poolId}>
                      {poolLabel(pool)}
                    </option>
                  ))}
                </select>
              </div>

              <Input
                label="Position size (token1 / USD notional)"
                type="number"
                inputMode="decimal"
                min="0"
                step="any"
                value={budget}
                error={rangeErrors.amountUsdOrToken}
                onChange={(e) => setBudget(e.target.value)}
                className="mt-3 font-mono"
              />

              <div className="mt-3">
                <span className="label-text mb-1 block text-xs text-base-content/60">Current pool price</span>
                <span className="block font-mono text-2xl font-semibold tabular-nums">{formatPrice(currentPrice)}</span>
                <span className="text-xs text-base-content/40">token1 per token0, derived from tick</span>
              </div>

              <div className="mt-3 grid grid-cols-2 gap-3">
                <Input
                  label="Lower price"
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="any"
                  value={lowerText}
                  error={rangeErrors.lowerPrice}
                  onChange={(e) => setLowerText(e.target.value)}
                  className="font-mono"
                />
                <Input
                  label="Upper price"
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="any"
                  value={upperText}
                  error={rangeErrors.upperPrice}
                  onChange={(e) => setUpperText(e.target.value)}
                  className="font-mono"
                />
              </div>
              {rangeErrors.currentPrice ? <p className="mt-1 text-xs text-error">{rangeErrors.currentPrice}</p> : null}
              {rangeErrors.upperPrice ? <p className="mt-1 text-xs text-error">{rangeErrors.upperPrice}</p> : null}

              <fieldset className="mt-4">
                <legend className="label-text text-xs">Range presets around current price</legend>
                <div className="mt-1 flex flex-wrap gap-2">
                  {RANGE_PRESETS.map((preset) => (
                    <button
                      key={preset.label}
                      type="button"
                      onClick={() => applyPreset(preset.spread)}
                      aria-label={`Set range ${preset.label} around current price`}
                      className="btn btn-ghost btn-sm border border-base-300 font-mono"
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>
              </fieldset>
            </CardBody>
          </Card>

          {allocation.ok && selectedPool ? (
            <Card>
              <CardBody>
                <CardTitle className="mb-2">Paper allocation</CardTitle>
                <div className="mb-2 flex items-center gap-2">
                  <span className="text-xs text-base-content/60">Position status</span>
                  <StatusBadge status={allocation.side} />
                </div>
                <div
                  className="flex h-3 w-full overflow-hidden rounded-md border border-base-300"
                  role="img"
                  aria-label={`Allocation: ${(allocation.token0Share * 100).toFixed(0)}% token0, ${(100 - allocation.token0Share * 100).toFixed(0)}% token1 by value`}
                >
                  <div
                    className="bg-primary transition-[width] duration-200"
                    style={{ width: `${allocation.token0Share * 100}%` }}
                  />
                  <div className="flex-1 bg-base-300" />
                </div>
                <div className="mt-3 grid grid-cols-2 gap-3">
                  <div>
                    <p className="text-xs text-base-content/60">Token0</p>
                    <p className="font-mono text-lg font-semibold tabular-nums">{formatAmount(allocation.amount0)}</p>
                    <p className="text-xs text-base-content/40">≈ ${formatAmount(allocation.value0Usd)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-base-content/60">Token1</p>
                    <p className="font-mono text-lg font-semibold tabular-nums">{formatAmount(allocation.amount1)}</p>
                    <p className="text-xs text-base-content/40">≈ ${formatAmount(allocation.value1Usd)}</p>
                  </div>
                </div>
                <p className="mt-3 border-t border-base-300 pt-2 text-xs text-base-content/40">
                  Pool fee {(feePercent ?? 0).toFixed(2)}% · entry value ${formatAmount(allocation.totalValueUsd)}
                </p>
              </CardBody>
            </Card>
          ) : null}
        </div>

        <div className="lg:col-span-3">
          <Card className="h-full">
            <CardBody>
              <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
                <CardTitle>Price move scenarios</CardTitle>
                <span className="badge badge-ghost font-mono">
                  entry ${scenarios ? formatAmount(scenarios.entryValueUsd) : "—"}
                </span>
              </div>
              <p className="mb-3 text-xs text-base-content/60">
                Values the allocated basket at each simulated price (amount0 × price + amount1). Fee column assumes one
                unit of turnover per 1% of price movement while in range — illustrative, not a forecast.
              </p>
              {scenarios ? (
                <ScenarioTable scenarios={scenarios.scenarios} showFees={feePercent !== undefined && feePercent > 0} />
              ) : (
                <p className="py-8 text-center text-sm text-base-content/60">
                  Fix the highlighted fields to generate scenarios.
                </p>
              )}
            </CardBody>
          </Card>
        </div>
      </div>
    </div>
  )
}

function StatusBadge({ status }: { status: "below" | "inside" | "above" }) {
  if (status === "inside") return <span className="badge badge-success badge-sm">In range</span>
  if (status === "below") return <span className="badge badge-warning badge-sm">Below range · all token0</span>
  return <span className="badge badge-warning badge-sm">Above range · all token1</span>
}

interface ScenarioTableProps {
  scenarios: readonly PriceScenario[]
  showFees: boolean
}

export function ScenarioTable({ scenarios, showFees }: ScenarioTableProps) {
  return (
    <div className="overflow-x-auto">
      <table className="table table-sm" aria-label="Simulated price move scenarios">
        <thead>
          <tr>
            <th scope="col">Price move</th>
            <th scope="col">Simulated price</th>
            <th scope="col">Status</th>
            <th scope="col" className="text-right">
              Position value
            </th>
            {showFees ? (
              <th scope="col" className="text-right">
                Est. fees
              </th>
            ) : null}
            <th scope="col" className="text-right">
              vs entry
            </th>
          </tr>
        </thead>
        <tbody>
          {scenarios.map((scenario) => (
            <tr key={scenario.priceChangePercent}>
              <td className="font-mono tabular-nums">
                {scenario.priceChangePercent > 0 ? "+" : ""}
                {scenario.priceChangePercent}%
              </td>
              <td className="font-mono tabular-nums">{formatPrice(scenario.simulatedPrice)}</td>
              <td>
                {scenario.status === "inside" ? (
                  <span className="badge badge-success badge-sm">In range</span>
                ) : (
                  <span className="badge badge-warning badge-sm">Out of range</span>
                )}
              </td>
              <td className="text-right font-mono tabular-nums">${formatAmount(scenario.totalValueUsd)}</td>
              {showFees ? (
                <td className="text-right font-mono tabular-nums">${formatAmount(scenario.estimatedFeesUsd)}</td>
              ) : null}
              <td
                className={`text-right font-mono tabular-nums ${scenario.changePercent > 0 ? "text-success" : scenario.changePercent < 0 ? "text-error" : ""}`}
              >
                {scenario.changePercent > 0 ? "+" : ""}
                {scenario.changePercent.toFixed(2)}%
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
