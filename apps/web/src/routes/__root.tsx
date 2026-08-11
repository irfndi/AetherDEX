import { createRootRoute, Link, Outlet } from "@tanstack/react-router"
import { TanStackRouterDevtools } from "@tanstack/react-router-devtools"
import { ThemeToggle } from "../components/ThemeToggle"
import { WalletConnect } from "../components/WalletConnect"

function Logo() {
  return (
    <Link to="/" className="group flex items-center gap-2">
      <span
        className="grid size-7 place-items-center rounded-md border border-base-content/20 bg-base-200 font-mono text-sm font-semibold text-primary transition-colors group-hover:border-primary/50"
        aria-hidden="true"
      >
        A
      </span>
      <span className="font-display text-lg font-medium tracking-tight text-base-content">
        Aether
        <span className="text-primary">.</span>
      </span>
    </Link>
  )
}

const NAV_LINKS = [
  { to: "/swap" as const, label: "Swap" },
  { to: "/pools" as const, label: "Pools" },
  { to: "/positions" as const, label: "Positions" },
  { to: "/portfolio" as const, label: "Portfolio" },
  { to: "/playground" as const, label: "Playground" },
]

export const Route = createRootRoute({
  component: RootComponent,
})

function RootComponent() {
  return (
    <div className="min-h-screen min-w-0 overflow-x-clip bg-base-100">
      <header className="sticky top-0 z-30 border-b hairline bg-base-100/85 backdrop-blur-md">
        <div className="container mx-auto flex min-h-14 flex-wrap items-center justify-between gap-3 px-4">
          <Logo />
          <nav className="order-3 flex w-full items-center justify-center gap-1 sm:order-none sm:w-auto sm:gap-1.5">
            {NAV_LINKS.map((link) => (
              <Link
                key={link.label}
                to={link.to}
                className="rounded-md px-3 py-1.5 text-sm font-medium text-base-content/60 transition-colors hover:bg-base-300/50 hover:text-base-content [&.active]:bg-base-300 [&.active]:text-base-content [&.active]:shadow-[inset_0_-2px_0_0_var(--color-primary)]"
              >
                {link.label}
              </Link>
            ))}
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
      <footer className="border-t hairline py-6">
        <div className="container mx-auto flex flex-wrap items-center justify-between gap-2 px-4 text-xs text-base-content/40">
          <p>
            Aether<span className="text-primary">.</span> — autonomous concentrated liquidity on Uniswap V4
          </p>
          <p className="font-mono">Non-custodial · bps on-chain · no token</p>
        </div>
      </footer>
      {import.meta.env.DEV && import.meta.env.VITE_SHOW_ROUTER_DEVTOOLS === "true" ? (
        <TanStackRouterDevtools position="bottom-right" />
      ) : null}
    </div>
  )
}
