import { useAppKit } from "@reown/appkit/react"
import { createFileRoute, Link } from "@tanstack/react-router"
import { type FormEvent, useEffect, useState } from "react"
import { useAccount } from "wagmi"
import { DexScreenerChart } from "../components/DexScreenerChart"
import { TokenChip } from "../components/TokenChip"
import { Button, Card, CardBody, Input, Stat } from "../components/ui"
import {
  buildLiquidityRequest,
  type LiquidityFormValues,
  type LiquiditySide,
  type LiquidityTransactionRequest,
  validateLiquidityForm,
} from "../lib/liquidity"

interface Pool {
  poolId: string
  token0Address: string
  token1Address: string
  fee: number
  tickSpacing: number
  sqrtPriceX96: string
  currentTick: number
  liquidity: string
  tvlUsd: number
  volume24hUsd: number
  fees24hUsd: number
  isActive: boolean
}

interface Token {
  address: string
  symbol: string
  name: string
  decimals: number
  logoURI?: string
}

export const Route = createFileRoute("/pools/$poolId")({
  component: PoolDetailPage,
  loader: ({ params }) => ({ poolId: params.poolId }),
})

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:8080/api/v1"

function PoolDetailPage() {
  const { poolId } = Route.useLoaderData()
  const [pool, setPool] = useState<Pool | null>(null)
  const [token0, setToken0] = useState<Token | null>(null)
  const [token1, setToken1] = useState<Token | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true)

    fetch(`${API_URL}/pools/${poolId}`)
      .then((r) => r.json())
      .then((data: { pool: Pool }) => {
        if (cancelled || !data.pool) return
        setPool(data.pool)

        return Promise.all([
          fetch(`${API_URL}/tokens/${data.pool.token0Address}`)
            .then((r) => r.json())
            .catch(() => null),
          fetch(`${API_URL}/tokens/${data.pool.token1Address}`)
            .then((r) => r.json())
            .catch(() => null),
        ]).then(([t0, t1]) => {
          if (cancelled) return
          if (t0?.token) setToken0(t0.token)
          if (t1?.token) setToken1(t1.token)
        })
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [poolId])

  if (loading) {
    return (
      <div className="mx-auto flex justify-center py-8">
        <span className="loading loading-spinner loading-lg" />
      </div>
    )
  }

  if (!pool) {
    return (
      <div className="mx-auto max-w-6xl py-8">
        <Card>
          <CardBody>
            <p className="py-8 text-center">Pool not found.</p>
            <div className="flex justify-center">
              <Link to="/pools" search={{ sortBy: "tvl", filterToken: "" }} className="btn btn-ghost btn-sm">
                ← Back to pools
              </Link>
            </div>
          </CardBody>
        </Card>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-6xl py-8">
      <div className="mb-6">
        <Link
          to="/pools"
          search={{ sortBy: "tvl", filterToken: "" }}
          className="text-sm text-base-content/60 hover:text-primary"
        >
          ← Back to pools
        </Link>
      </div>

      <div className="mb-6 flex items-center gap-3">
        {token0 ? <TokenChip token={token0} /> : null}
        <span className="text-2xl text-base-content/40">/</span>
        {token1 ? <TokenChip token={token1} /> : null}
        <span className="badge badge-ghost ml-2">{(pool.fee / 10_000).toFixed(2)}% fee</span>
      </div>

      <div className="stats stats-horizontal mb-6 bg-transparent">
        <Stat label="TVL" value={`$${formatUsd(pool.tvlUsd)}`} />
        <Stat label="Volume 24h" value={`$${formatUsd(pool.volume24hUsd)}`} />
        <Stat label="Fees 24h" value={`$${formatUsd(pool.fees24hUsd)}`} />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Card>
            <CardBody>
              <h2 className="card-title mb-4">Chart</h2>
              <DexScreenerChart tokenAddress={pool.token0Address} />
            </CardBody>
          </Card>
        </div>

        <div>
          <LiquidityForm pool={pool} token0={token0} token1={token1} />
        </div>
      </div>
    </div>
  )
}

interface LiquidityFormProps {
  readonly pool: Pool
  readonly token0: Token | null
  readonly token1: Token | null
}

function LiquidityForm({ pool, token0, token1 }: LiquidityFormProps) {
  const { open } = useAppKit()
  const { address, isConnected } = useAccount()
  const [values, setValues] = useState<LiquidityFormValues>({
    tokenSide: "token0",
    amount: "",
    lowerTick: "-600",
    upperTick: "600",
    slippage: "0.5",
    deadline: "1800",
  })
  const [submitted, setSubmitted] = useState(false)
  const [request, setRequest] = useState<LiquidityTransactionRequest | null>(null)

  const validation = validateLiquidityForm(values, pool.tickSpacing)
  const errors = submitted ? validation.errors : {}
  const selectedToken = values.tokenSide === "token0" ? token0 : token1
  const otherToken = values.tokenSide === "token0" ? token1 : token0
  const walletName = address ? `${address.slice(0, 6)}…${address.slice(-4)}` : "Wallet not connected"

  const updateValue = (field: keyof LiquidityFormValues, value: string) => {
    setValues((current) => ({ ...current, [field]: value }))
    setRequest(null)
  }

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setSubmitted(true)
    if (!isConnected) {
      open()
      return
    }

    const nextRequest = buildLiquidityRequest(pool.poolId, values, pool.tickSpacing)
    if (nextRequest) setRequest(nextRequest)
  }

  return (
    <Card>
      <CardBody>
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 className="card-title">Add liquidity</h2>
            <p className="mt-1 text-sm text-base-content/60">Choose a range and deposit from one side.</p>
          </div>
          <span className={`badge ${isConnected ? "badge-success" : "badge-warning"}`}>
            {isConnected ? "Connected" : "Connect wallet"}
          </span>
        </div>

        <div className="mb-5 rounded-box border border-base-300 bg-base-100 p-3 text-sm">
          <div className="flex items-center justify-between gap-3">
            <span className="text-base-content/60">Wallet</span>
            {isConnected ? (
              <span className="font-mono text-xs">{walletName}</span>
            ) : (
              <Button type="button" variant="outline" size="xs" onClick={() => open()}>
                Connect
              </Button>
            )}
          </div>
        </div>

        <form onSubmit={submit} noValidate className="space-y-4">
          <fieldset>
            <legend className="label-text mb-2 block text-sm font-medium">Deposit from</legend>
            <div className="join w-full">
              {(["token0", "token1"] as const).map((side: LiquiditySide) => {
                const token = side === "token0" ? token0 : token1
                return (
                  <button
                    className={`join-item btn btn-sm flex-1 ${values.tokenSide === side ? "btn-primary" : "btn-ghost"}`}
                    key={side}
                    type="button"
                    aria-pressed={values.tokenSide === side}
                    onClick={() => updateValue("tokenSide", side)}
                  >
                    {token?.symbol ?? (side === "token0" ? "Token 0" : "Token 1")}
                  </button>
                )
              })}
            </div>
          </fieldset>

          <Input
            id="liquidity-amount"
            label={`Amount (${selectedToken?.symbol ?? "selected token"})`}
            inputMode="decimal"
            min="0"
            step="any"
            placeholder="0.00"
            value={values.amount}
            {...(errors.amount ? { error: errors.amount } : {})}
            onChange={(event) => updateValue("amount", event.target.value)}
          />

          <div>
            <div className="mb-2 flex items-center justify-between">
              <span className="label-text text-sm font-medium">Price range</span>
              <span className="text-xs text-base-content/60">Tick spacing: {pool.tickSpacing}</span>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Input
                id="liquidity-lower-tick"
                label="Lower tick"
                type="number"
                step={pool.tickSpacing}
                value={values.lowerTick}
                {...(errors.lowerTick ? { error: errors.lowerTick } : {})}
                onChange={(event) => updateValue("lowerTick", event.target.value)}
              />
              <Input
                id="liquidity-upper-tick"
                label="Upper tick"
                type="number"
                step={pool.tickSpacing}
                value={values.upperTick}
                {...(errors.upperTick ? { error: errors.upperTick } : {})}
                onChange={(event) => updateValue("upperTick", event.target.value)}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Input
              id="liquidity-slippage"
              label="Max slippage (%)"
              type="number"
              min="0"
              max="5"
              step="0.1"
              value={values.slippage}
              {...(errors.slippage ? { error: errors.slippage } : {})}
              onChange={(event) => updateValue("slippage", event.target.value)}
            />
            <Input
              id="liquidity-deadline"
              label="Deadline (seconds)"
              type="number"
              min="60"
              max="86400"
              step="60"
              value={values.deadline}
              {...(errors.deadline ? { error: errors.deadline } : {})}
              onChange={(event) => updateValue("deadline", event.target.value)}
            />
          </div>

          <div className="rounded-box border border-base-300 bg-base-100 p-3 text-xs text-base-content/60">
            <div className="flex justify-between gap-3">
              <span>Range</span>
              <span className="font-mono">
                {values.lowerTick || "—"} to {values.upperTick || "—"}
              </span>
            </div>
            <div className="mt-2 flex justify-between gap-3">
              <span>Other side</span>
              <span>{otherToken?.symbol ?? "Token unavailable"} calculated at execution</span>
            </div>
          </div>

          {request ? (
            <div role="status" className="alert alert-warning text-sm">
              <span>
                Request prepared locally. The router address is not configured yet, so nothing was submitted and no
                transaction succeeded.
              </span>
            </div>
          ) : null}

          <Button
            type="submit"
            variant="primary"
            fullWidth
            disabled={isConnected && (!validation.valid || request !== null)}
          >
            {request
              ? "Transaction unavailable"
              : isConnected
                ? "Prepare liquidity request"
                : "Connect wallet to continue"}
          </Button>
        </form>

        <div className="divider">Pool info</div>
        <div className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-base-content/60">Current tick</span>
            <span className="font-mono text-xs">{pool.currentTick}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-base-content/60">Liquidity</span>
            <span className="font-mono text-xs">{pool.liquidity.slice(0, 10)}…</span>
          </div>
        </div>
      </CardBody>
    </Card>
  )
}

function formatUsd(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`
  if (value >= 1_000) return `${(value / 1_000).toFixed(2)}K`
  if (value >= 1) return value.toFixed(2)
  if (value > 0) return value.toFixed(4)
  return "0.00"
}
