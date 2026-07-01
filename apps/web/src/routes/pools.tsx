import { createFileRoute, Link } from "@tanstack/react-router"
import { useEffect, useState } from "react"
import { TokenChip } from "../components/TokenChip"
import { Card, CardBody, Input, Stat } from "../components/ui"

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

export const Route = createFileRoute("/pools")({
  component: PoolsPage,
  validateSearch: (search: Record<string, unknown>) => ({
    sortBy: (search.sortBy as string) ?? "tvl",
    filterToken: (search.filterToken as string) ?? "",
  }),
})

const SORT_OPTIONS = [
  { value: "tvl", label: "TVL" },
  { value: "volume", label: "Volume 24h" },
  { value: "fees", label: "Fees 24h" },
] as const

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:8080/api/v1"

function PoolsPage() {
  const { sortBy, filterToken } = Route.useSearch()
  const navigate = Route.useNavigate()
  const [pools, setPools] = useState<Pool[]>([])
  const [tokens, setTokens] = useState<Record<string, Token>>({})
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState(filterToken)

  useEffect(() => {
    fetch(`${API_URL}/tokens?verified=true&limit=200`)
      .then((r) => r.json())
      .then((data: { tokens: Token[] }) => {
        const map: Record<string, Token> = {}
        for (const t of data.tokens ?? []) map[t.address.toLowerCase()] = t
        setTokens(map)
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    setLoading(true)
    const params = new URLSearchParams({
      sortBy,
      sortDirection: "desc",
      limit: "50",
    })
    if (filterToken) params.set("filterToken", filterToken)

    fetch(`${API_URL}/pools?${params.toString()}`)
      .then((r) => r.json())
      .then((data: { pools: Pool[] }) => {
        setPools(data.pools ?? [])
      })
      .catch(() => setPools([]))
      .finally(() => setLoading(false))
  }, [sortBy, filterToken])

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault()
    navigate({ search: { sortBy, filterToken: search } })
  }

  return (
    <div className="mx-auto max-w-6xl py-8">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-3xl font-bold">Pools</h1>
        <Link to="/swap" className="btn btn-primary btn-sm">
          New Position
        </Link>
      </div>

      <div className="mb-6 flex flex-wrap items-end gap-4">
        <form onSubmit={handleSearch} className="max-w-sm flex-1">
          <Input
            label="Filter by token"
            placeholder="0x… or symbol"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </form>
        <div className="flex flex-col gap-1">
          <label htmlFor="sort-select" className="label-text text-xs">
            Sort by
          </label>
          <div className="join" id="sort-select">
            {SORT_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => navigate({ search: { sortBy: opt.value, filterToken } })}
                className={`join-item btn btn-sm ${sortBy === opt.value ? "btn-primary" : "btn-ghost"}`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-12">
          <span className="loading loading-spinner loading-lg" />
        </div>
      ) : pools.length === 0 ? (
        <Card>
          <CardBody>
            <p className="py-8 text-center text-base-content/60">No pools found.</p>
          </CardBody>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {pools.map((pool) => {
            const t0 = tokens[pool.token0Address.toLowerCase()]
            const t1 = tokens[pool.token1Address.toLowerCase()]
            return (
              <Link
                key={pool.poolId}
                to="/pools/$poolId"
                params={{ poolId: pool.poolId }}
                search={{ sortBy: "tvl", filterToken: "" }}
                className="block"
              >
                <Card className="transition-colors hover:border-primary">
                  <CardBody>
                    <div className="mb-3 flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        {t0 ? <TokenChip token={t0} /> : null}
                        <span className="text-base-content/40">/</span>
                        {t1 ? <TokenChip token={t1} /> : null}
                      </div>
                      <span className="badge badge-ghost">{(pool.fee / 10_000).toFixed(2)}%</span>
                    </div>
                    <div className="stats stats-horizontal bg-transparent">
                      <Stat label="TVL" value={`$${formatUsd(pool.tvlUsd)}`} />
                      <Stat label="Vol 24h" value={`$${formatUsd(pool.volume24hUsd)}`} />
                      <Stat label="Fees 24h" value={`$${formatUsd(pool.fees24hUsd)}`} />
                    </div>
                  </CardBody>
                </Card>
              </Link>
            )
          })}
        </div>
      )}
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
