import { useQuery } from "@tanstack/react-query"
import { createFileRoute, Link } from "@tanstack/react-router"
import { DexScreenerChart } from "../components/DexScreenerChart"
import { LiquidityForm, type Pool, type Token } from "../components/liquidity/LiquidityForm"
import { TokenChip } from "../components/TokenChip"
import { Button } from "../components/ui/Button"
import { Card, CardBody } from "../components/ui/Card"
import { Stat } from "../components/ui/Stat"
import { API_URL } from "../lib/api"

export const Route = createFileRoute("/pools/$poolId")({
  component: PoolDetailPage,
  loader: ({ params }) => ({ poolId: params.poolId }),
})

async function fetchPool(poolId: string): Promise<Pool | null> {
  const res = await fetch(`${API_URL}/pools/${poolId}`)
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`Failed to load pool: HTTP ${res.status}`)
  const data = (await res.json()) as { pool: Pool }
  return data.pool ?? null
}

async function fetchPoolToken(address: string): Promise<Token | null> {
  const res = await fetch(`${API_URL}/tokens/${address}`)
  if (!res.ok) return null
  const data = (await res.json()) as { token?: Token }
  return data.token ?? null
}

function PoolDetailPage() {
  const { poolId } = Route.useLoaderData()

  const poolQuery = useQuery({
    queryKey: ["pool", poolId],
    queryFn: () => fetchPool(poolId),
    staleTime: 30_000,
  })

  const pool = poolQuery.data ?? null

  const token0Query = useQuery({
    queryKey: ["token", pool?.token0Address],
    queryFn: () => (pool ? fetchPoolToken(pool.token0Address) : Promise.resolve(null)),
    enabled: pool !== null && pool !== undefined,
    staleTime: 60_000,
  })

  const token1Query = useQuery({
    queryKey: ["token", pool?.token1Address],
    queryFn: () => (pool ? fetchPoolToken(pool.token1Address) : Promise.resolve(null)),
    enabled: pool !== null && pool !== undefined,
    staleTime: 60_000,
  })

  const token0 = token0Query.data ?? null
  const token1 = token1Query.data ?? null
  const loading = poolQuery.isPending
  const error = poolQuery.isError ? "Failed to load pool" : null

  if (loading) {
    return (
      <div className="mx-auto flex justify-center py-8">
        <span className="loading loading-spinner loading-lg" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="mx-auto max-w-6xl py-8">
        <Card>
          <CardBody>
            <p className="py-8 text-center">{error}</p>
            <div className="flex justify-center gap-2">
              <Button variant="primary" size="sm" onClick={() => poolQuery.refetch()}>
                Retry
              </Button>
              <Link to="/pools" search={{ sortBy: "tvl", filterToken: "" }} className="btn btn-ghost btn-sm">
                ← Back to pools
              </Link>
            </div>
          </CardBody>
        </Card>
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
          className="inline-flex items-center gap-1 text-sm text-base-content/60 transition-colors hover:text-primary"
        >
          <span aria-hidden="true">←</span> Back to pools
        </Link>
      </div>

      <div className="mb-6 flex flex-wrap items-center gap-3">
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
              <h2 className="card-title mb-4 font-display text-lg font-medium">Chart</h2>
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

function formatUsd(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`
  if (value >= 1_000) return `${(value / 1_000).toFixed(2)}K`
  if (value >= 1) return value.toFixed(2)
  if (value > 0) return value.toFixed(4)
  return "0.00"
}
