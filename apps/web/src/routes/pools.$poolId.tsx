import { createFileRoute, Link } from "@tanstack/react-router"
import { useEffect, useState } from "react"
import { DexScreenerChart } from "../components/DexScreenerChart"
import { TokenChip } from "../components/TokenChip"
import { Button, Card, CardBody, Stat } from "../components/ui"

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
          <Card>
            <CardBody>
              <h2 className="card-title mb-4">Add Liquidity</h2>
              <p className="mb-4 text-sm text-base-content/60">
                Coming in T29 — connects to AetherRouter.addLiquidity().
              </p>
              <Button variant="primary" fullWidth disabled>
                Add Liquidity
              </Button>

              <div className="divider">Pool Info</div>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-base-content/60">Tick spacing</span>
                  <span>{pool.tickSpacing}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-base-content/60">Liquidity</span>
                  <span className="font-mono text-xs">{pool.liquidity.slice(0, 10)}…</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-base-content/60">Sqrt price</span>
                  <span className="font-mono text-xs">{pool.sqrtPriceX96.slice(0, 10)}…</span>
                </div>
              </div>
            </CardBody>
          </Card>
        </div>
      </div>
    </div>
  )
}

function formatUsd(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`
  if (value >= 1_000) return `${(value / 1_000).toFixed(2)}K`
  if (value >= 1) return value.toFixed(2)
  if (value > 0) return value.toFixed(4)
  return "0.00"
}
