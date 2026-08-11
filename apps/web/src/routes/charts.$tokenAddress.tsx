import { createFileRoute } from "@tanstack/react-router"
import { DexScreenerChart } from "../components/DexScreenerChart"
import { PoolStats } from "../components/PoolStats"
import { PriceTicker } from "../components/PriceTicker"
import { PageHeader } from "../components/ui/PageHeader"

export const Route = createFileRoute("/charts/$tokenAddress")({
  component: TokenChartPage,
  loader: ({ params }) => ({ tokenAddress: params.tokenAddress }),
})

function TokenChartPage() {
  const { tokenAddress } = Route.useLoaderData()

  return (
    <div className="mx-auto max-w-5xl space-y-6 py-8">
      <PageHeader
        title="Token chart"
        eyebrow="Market data"
        description="Price, liquidity and volume for a token, sourced from DexScreener."
        actions={<PriceTicker key={tokenAddress} tokenAddress={tokenAddress} showVolume />}
      />

      <PoolStats tokenAddress={tokenAddress} />

      <DexScreenerChart tokenAddress={tokenAddress} />

      <p className="text-center text-xs text-base-content/40">Chart data provided by DexScreener</p>
    </div>
  )
}
