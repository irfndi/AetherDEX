import { createFileRoute } from "@tanstack/react-router"

export const Route = createFileRoute("/swap")({
  component: SwapPage,
})

function SwapPage() {
  return (
    <div className="mx-auto max-w-md py-8">
      <div className="card bg-base-200">
        <div className="card-body">
          <h2 className="card-title">Swap</h2>
          <p className="text-base-content/60">Swap UI coming in T24. This is a placeholder route.</p>
        </div>
      </div>
    </div>
  )
}
