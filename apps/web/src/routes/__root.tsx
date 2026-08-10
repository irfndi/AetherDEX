import { createRootRoute, Link, Outlet } from "@tanstack/react-router"
import { TanStackRouterDevtools } from "@tanstack/router-devtools"
import { ThemeToggle } from "../components/ThemeToggle"
import { WalletConnect } from "../components/WalletConnect"

export const Route = createRootRoute({
  component: RootComponent,
})

function RootComponent() {
  return (
    <div className="min-h-screen min-w-0 overflow-x-clip bg-base-100">
      <header className="navbar sticky top-0 z-30 border-b border-base-300/70 bg-base-100/80 backdrop-blur-md">
        <div className="container mx-auto flex flex-wrap items-center justify-between gap-4 px-4">
          <Link to="/" className="font-display text-xl font-bold tracking-tight text-aurora">
            AetherDEX
          </Link>
          <nav className="order-3 flex w-full flex-wrap justify-center gap-1 sm:order-none sm:w-auto sm:gap-2">
            <Link
              to="/swap"
              className="rounded-lg px-3 py-1.5 text-sm font-medium text-base-content/70 transition-colors hover:bg-base-300/60 hover:text-base-content [&.active]:bg-base-300 [&.active]:text-base-content"
            >
              Swap
            </Link>
            <Link
              to="/pools"
              search={{ sortBy: "tvl", filterToken: "" }}
              className="rounded-lg px-3 py-1.5 text-sm font-medium text-base-content/70 transition-colors hover:bg-base-300/60 hover:text-base-content [&.active]:bg-base-300 [&.active]:text-base-content"
            >
              Pools
            </Link>
            <Link
              to="/positions"
              className="rounded-lg px-3 py-1.5 text-sm font-medium text-base-content/70 transition-colors hover:bg-base-300/60 hover:text-base-content [&.active]:bg-base-300 [&.active]:text-base-content"
            >
              Positions
            </Link>
            <Link
              to="/portfolio"
              className="rounded-lg px-3 py-1.5 text-sm font-medium text-base-content/70 transition-colors hover:bg-base-300/60 hover:text-base-content [&.active]:bg-base-300 [&.active]:text-base-content"
            >
              Portfolio
            </Link>
            <Link
              to="/playground"
              className="rounded-lg px-3 py-1.5 text-sm font-medium text-base-content/70 transition-colors hover:bg-base-300/60 hover:text-base-content [&.active]:bg-base-300 [&.active]:text-base-content"
            >
              Playground
            </Link>
          </nav>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <WalletConnect />
          </div>
        </div>
      </header>
      <main className="container mx-auto min-w-0 px-4 py-6">
        <Outlet />
      </main>
      {import.meta.env.DEV && import.meta.env.VITE_SHOW_ROUTER_DEVTOOLS === "true" ? (
        <TanStackRouterDevtools position="bottom-right" />
      ) : null}
    </div>
  )
}
