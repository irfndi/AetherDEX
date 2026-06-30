import { createFileRoute } from "@tanstack/react-router"

export const Route = createFileRoute("/portfolio")({
  component: PortfolioPage,
})

function PortfolioPage() {
  return (
    <div className="mx-auto max-w-4xl py-8">
      <h1 className="text-3xl font-bold">Portfolio</h1>
      <p className="mt-4 text-base-content/60">Connect wallet to view your portfolio.</p>
    </div>
  )
}
