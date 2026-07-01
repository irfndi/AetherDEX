import { base, baseSepolia, mainnet, sepolia } from "@reown/appkit/networks"
import { createAppKit } from "@reown/appkit/react"
import { WagmiAdapter } from "@reown/appkit-adapter-wagmi"
import type { ReactNode } from "react"
import { type Config, cookieStorage, createStorage, WagmiProvider } from "wagmi"

// Get a Reown project ID from https://cloud.reown.com
const projectId = import.meta.env.VITE_REOWN_PROJECT_ID
if (!projectId) {
  throw new Error("VITE_REOWN_PROJECT_ID is required. Get one at https://cloud.reown.com")
}

const networks = [mainnet, sepolia, base, baseSepolia] as unknown as [
  Parameters<typeof createAppKit>[0]["networks"][number],
  ...Parameters<typeof createAppKit>[0]["networks"],
]

const wagmiAdapter = new WagmiAdapter({
  storage: createStorage({ storage: cookieStorage }),
  ssr: false,
  projectId,
  networks,
})

// Cast needed: @reown/appkit-adapter-wagmi ships with @wagmi/core v2 types
// while wagmi v3 uses @wagmi/core v3. Runtime is compatible.
export const config = wagmiAdapter.wagmiConfig as unknown as Config

// Initialize AppKit modal
createAppKit({
  // biome-ignore lint/suspicious/noExplicitAny: Adapter type mismatch between @wagmi/core v2/v3
  adapters: [wagmiAdapter as any],
  networks,
  projectId,
  metadata: {
    name: "AetherDEX",
    description: "Lean spot DEX on Uniswap V4",
    url: "https://aetherdex.io",
    icons: ["https://aetherdex.io/icon.png"],
  },
  features: {
    analytics: false,
    email: false,
    socials: false,
  },
  themeMode: "dark",
  themeVariables: {
    "--w3m-accent": "#0EA5E9",
    "--w3m-font-family": '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  },
})

export function AppKitProvider({ children }: { children: ReactNode }) {
  return <WagmiProvider config={config}>{children}</WagmiProvider>
}
