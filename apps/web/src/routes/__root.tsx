import { createRootRoute, Link, Outlet } from "@tanstack/react-router"
import { TanStackRouterDevtools } from "@tanstack/router-devtools"
import { ThemeToggle } from "../components/ThemeToggle"
import { WalletConnect } from "../components/WalletConnect"

export const Route = createRootRoute({
  component: RootComponent,
})

function RootComponent() {
  return (
    <div className="min-h-screen bg-base-100">
      <header className="navbar border-b border-base-300 bg-base-200">
        <div className="container mx-auto flex flex-wrap items-center justify-between gap-4 px-4">
          <Link to="/" className="text-xl font-bold text-primary">
            AetherDEX
          </Link>
          <nav className="order-3 flex w-full flex-wrap justify-center gap-4 sm:order-none sm:w-auto sm:gap-6">
            <Link to="/swap" className="text-sm font-medium hover:text-primary [&.active]:text-primary">
              Swap
            </Link>
            <Link
              to="/pools"
              search={{ sortBy: "tvl", filterToken: "" }}
              className="text-sm font-medium hover:text-primary [&.active]:text-primary"
            >
              Pools
            </Link>
            <Link to="/positions" className="text-sm font-medium hover:text-primary [&.active]:text-primary">
              Positions
            </Link>
            <Link to="/portfolio" className="text-sm font-medium hover:text-primary [&.active]:text-primary">
              Portfolio
            </Link>
            <Link to="/playground" className="text-sm font-medium hover:text-primary [&.active]:text-primary">
              Playground
            </Link>
          </nav>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <WalletConnect />
          </div>
        </div>
      </header>
      <main className="container mx-auto px-4 py-6">
        <Outlet />
      </main>
      {import.meta.env.DEV && import.meta.env.VITE_SHOW_ROUTER_DEVTOOLS === "true" ? (
        <TanStackRouterDevtools position="bottom-right" />
      ) : null}
    </div>
  )
}
