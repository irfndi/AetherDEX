import { createFileRoute } from "@tanstack/react-router"

export const Route = createFileRoute("/")({
  component: HomePage,
})

function HomePage() {
  return (
    <div className="flex flex-col items-center justify-center py-20">
      <h1 className="text-5xl font-bold">AetherDEX</h1>
      <p className="mt-4 text-base-content/70">Lean spot DEX on Uniswap V4</p>
      <p className="mt-2 text-sm text-base-content/50">Scaffold ready. Swap UI coming in T24.</p>
    </div>
  )
}
