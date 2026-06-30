import { createFileRoute } from "@tanstack/react-router"
import { DexScreenerChart } from "../components/DexScreenerChart"
import { PoolStats } from "../components/PoolStats"
import { PriceTicker } from "../components/PriceTicker"

export const Route = createFileRoute("/charts/$tokenAddress")({
  component: TokenChartPage,
  loader: ({ params }) => ({ tokenAddress: params.tokenAddress }),
})

function TokenChartPage() {
  const { tokenAddress } = Route.useLoaderData()

  return (
    <div className="mx-auto max-w-5xl space-y-6 py-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-base-content">Token Chart</h1>
        <PriceTicker tokenAddress={tokenAddress} showVolume />
      </div>

      <PoolStats tokenAddress={tokenAddress} />

      <DexScreenerChart tokenAddress={tokenAddress} />

      <p className="text-center text-xs text-base-content/40">Chart data provided by DexScreener</p>
    </div>
  )
}
