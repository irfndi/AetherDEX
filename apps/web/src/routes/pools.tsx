import { createFileRoute } from "@tanstack/react-router"

export const Route = createFileRoute("/pools")({
  component: PoolsPage,
})

function PoolsPage() {
  return (
    <div className="mx-auto max-w-4xl py-8">
      <h1 className="text-3xl font-bold">Pools</h1>
      <p className="mt-4 text-base-content/60">Pool list coming in T25. This is a placeholder route.</p>
    </div>
  )
}
