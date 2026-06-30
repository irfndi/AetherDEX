import { Link, Outlet, createRootRoute } from "@tanstack/react-router"
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
        <div className="container mx-auto flex items-center justify-between px-4">
          <Link to="/" className="text-xl font-bold text-primary">
            AetherDEX
          </Link>
          <nav className="flex gap-6">
            <Link to="/swap" className="text-sm font-medium hover:text-primary [&.active]:text-primary">
              Swap
            </Link>
            <Link to="/pools" className="text-sm font-medium hover:text-primary [&.active]:text-primary">
              Pools
            </Link>
            <Link to="/portfolio" className="text-sm font-medium hover:text-primary [&.active]:text-primary">
              Portfolio
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
      {import.meta.env.DEV && <TanStackRouterDevtools position="bottom-right" />}
    </div>
  )
}
