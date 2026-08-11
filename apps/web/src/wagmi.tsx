import { base, baseSepolia, mainnet, sepolia } from "@reown/appkit/networks"
import { createAppKit } from "@reown/appkit/react"
import { WagmiAdapter } from "@reown/appkit-adapter-wagmi"
import type { ReactNode } from "react"
import { type Config, cookieStorage, createStorage, WagmiProvider } from "wagmi"

const networks = [mainnet, sepolia, base, baseSepolia] as unknown as [
  Parameters<typeof createAppKit>[0]["networks"][number],
  ...Parameters<typeof createAppKit>[0]["networks"],
]

// All @wagmi/core v2/v3 adapter casts live in this initializer: the adapter
// package ships with @wagmi/core v2 types while wagmi v3 uses @wagmi/core v3.
// Runtime is compatible; typecheck cannot see across the seam, so this module
// is the single place to revisit when either package bumps a major version.
let appKitConfig: Config | undefined

function getAppKitConfig(): Config | null {
  if (appKitConfig !== undefined) return appKitConfig
  // Get a Reown project ID from https://cloud.reown.com
  const projectId = import.meta.env.VITE_REOWN_PROJECT_ID
  if (!projectId) return null
  const wagmiAdapter = new WagmiAdapter({
    storage: createStorage({ storage: cookieStorage }),
    ssr: false,
    projectId,
    networks,
  })
  const config = wagmiAdapter.wagmiConfig as unknown as Config

  // Cast needed: @reown/appkit-adapter-wagmi ships with @wagmi/core v2 types
  // while wagmi v3 uses @wagmi/core v3. Runtime is compatible.
  const adapters = [wagmiAdapter] as unknown as NonNullable<Parameters<typeof createAppKit>[0]["adapters"]>

  // Initialize AppKit modal
  createAppKit({
    adapters,
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
      "--apkt-accent": "#7c6cff",
      "--w3m-accent": "#7c6cff",
      "--w3m-font-family": '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    },
  })

  appKitConfig = config
  return config
}

export function AppKitProvider({ children }: { children: ReactNode }) {
  const config = getAppKitConfig()
  if (!config) {
    return (
      <div role="alert" className="p-6 text-center">
        <p className="font-semibold">Wallet connection is unavailable</p>
        <p className="text-sm opacity-70">
          VITE_REOWN_PROJECT_ID is required. Set it in the environment and restart the app.
        </p>
      </div>
    )
  }
  return <WagmiProvider config={config}>{children}</WagmiProvider>
}
