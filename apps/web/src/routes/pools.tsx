import type { Pool } from "@aetherdex/shared"
import { useQuery } from "@tanstack/react-query"
import { createFileRoute, Link } from "@tanstack/react-router"
import { useEffect, useState } from "react"
import { TokenChip } from "../components/TokenChip"
import { Card, CardBody, Input, Stat } from "../components/ui"
import { poolsQueryOptions } from "../lib/pools-query"

interface Token {
  address: string
  symbol: string
  name: string
  decimals: number
  logoURI?: string
}

const SORT_OPTIONS = [
  { value: "tvl", label: "TVL" },
  { value: "volume", label: "Volume 24h" },
  { value: "fees", label: "Fees 24h" },
] as const

type SortBy = (typeof SORT_OPTIONS)[number]["value"]

const isSortBy = (value: unknown): value is SortBy => SORT_OPTIONS.some((option) => option.value === value)

export const Route = createFileRoute("/pools")({
  component: PoolsPage,
  validateSearch: (search: Record<string, unknown>) => ({
    sortBy: isSortBy(search.sortBy) ? search.sortBy : "tvl",
    filterToken: (search.filterToken as string) ?? "",
  }),
})

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:8080/api/v1"

function PoolsPage() {
  const { sortBy, filterToken } = Route.useSearch()
  const navigate = Route.useNavigate()
  const [tokens, setTokens] = useState<Record<string, Token>>({})
  const [search, setSearch] = useState(filterToken)

  const { data, isPending, isError, refetch } = useQuery(
    poolsQueryOptions(50, 0, {
      sortBy,
      sortDirection: "desc",
      filterToken: filterToken === "" ? undefined : filterToken,
    }),
  )
  const pools = data?.pools ?? []

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

      <PoolsResults isPending={isPending} isError={isError} pools={pools} tokens={tokens} onRetry={() => refetch()} />
    </div>
  )
}

interface PoolsResultsProps {
  isPending: boolean
  isError: boolean
  pools: readonly Pool[]
  tokens: Record<string, Token>
  onRetry: () => void
}

export function PoolsResults({ isPending, isError, pools, tokens, onRetry }: PoolsResultsProps) {
  if (isPending) {
    return (
      <div className="flex justify-center py-12">
        <span className="loading loading-spinner loading-lg" />
      </div>
    )
  }

  if (isError) {
    return (
      <Card>
        <CardBody>
          <p className="text-center font-medium">Failed to load pools.</p>
          <p className="mt-1 text-center text-sm text-base-content/60">
            Pool data is temporarily unavailable — please retry.
          </p>
          <div className="mt-4 flex justify-center">
            <button type="button" onClick={onRetry} className="btn btn-primary btn-sm">
              Retry
            </button>
          </div>
        </CardBody>
      </Card>
    )
  }

  if (pools.length === 0) {
    return (
      <Card>
        <CardBody>
          <p className="py-8 text-center text-base-content/60">No pools found.</p>
        </CardBody>
      </Card>
    )
  }

  return (
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
  )
}

function formatUsd(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`
  if (value >= 1_000) return `${(value / 1_000).toFixed(2)}K`
  if (value >= 1) return value.toFixed(2)
  if (value > 0) return value.toFixed(4)
  return "0.00"
}
