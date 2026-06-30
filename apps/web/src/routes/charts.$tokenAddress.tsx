import { createFileRoute } from "@tanstack/react-router"

export const Route = createFileRoute("/charts/$tokenAddress")({
  component: TokenChartPage,
  loader: ({ params }) => ({ tokenAddress: params.tokenAddress }),
})

function TokenChartPage() {
  const { tokenAddress } = Route.useLoaderData()
  return (
    <div className="mx-auto max-w-4xl py-8">
      <h1 className="text-3xl font-bold">Token {tokenAddress.slice(0, 10)}…</h1>
      <p className="mt-4 text-base-content/60">Chart coming in T26 (DexScreener embed).</p>
    </div>
  )
}
