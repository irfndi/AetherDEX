import { createFileRoute } from "@tanstack/react-router"

export const Route = createFileRoute("/pools/$poolId")({
  component: PoolDetailPage,
  loader: ({ params }) => ({ poolId: params.poolId }),
})

function PoolDetailPage() {
  const { poolId } = Route.useLoaderData()
  return (
    <div className="mx-auto max-w-4xl py-8">
      <h1 className="text-3xl font-bold">Pool {poolId.slice(0, 10)}…</h1>
      <p className="mt-4 text-base-content/60">Pool detail UI coming soon.</p>
    </div>
  )
}
