import { resolve } from "node:path"
import { cloudflareTest } from "@cloudflare/vitest-pool-workers"
import { defineConfig } from "vitest/config"

// workerd cannot load `ethers@5` / `@ethersproject/*` (extensionless relative
// imports + circular named exports break ESM linking; their CJS builds trip
// the cjs-shim on nested bare requires). Alias the exact bare specifiers the
// Uniswap SDK barrels import to a viem-backed shim — this pipeline only:
// production bundles the real packages via esbuild, and tsc still
// type-checks against the real packages. Pre-bundle the remaining pure-JS
// math deps (workerd known-issue: #module-resolution).
const ETHERS_SHIM = resolve(__dirname, "./test/shims/ethers-worker-shim.ts")

const ethersShimAliases = [
  "ethers",
  "ethers/lib/utils",
  "@ethersproject/abi",
  "@ethersproject/address",
  "@ethersproject/solidity",
  "@ethersproject/abstract-signer",
].map((spec) => ({
  find: new RegExp(`^${spec.replace(/[/\\]/g, "\\/")}$`),
  replacement: ETHERS_SHIM,
}))

const DEPS_TO_PREBUNDLE = [
  "@uniswap/v4-sdk",
  "@uniswap/v3-sdk",
  "@uniswap/sdk-core",
  "jsbi",
  "tiny-invariant",
  "tiny-warning",
  "decimal.js-light",
  "big.js",
  "toformat",
  "siwe",
]

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: resolve(__dirname, "./wrangler.jsonc") },
      miniflare: {
        compatibilityFlags: ["nodejs_compat"],
      },
    }),
  ],
  resolve: {
    alias: ethersShimAliases,
  },
  test: {
    setupFiles: ["./test/setup.ts"],
    server: {
      deps: {
        inline: ["siwe", "@reown/appkit", "@reown/appkit-adapter-wagmi"],
      },
    },
    deps: {
      optimizer: {
        web: { enabled: true, include: DEPS_TO_PREBUNDLE },
        ssr: { enabled: true, include: DEPS_TO_PREBUNDLE },
      },
    },
    coverage: {
      provider: "istanbul",
      reporter: ["text", "html", "lcov"],
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.d.ts", "src/**/*.test.ts"],
    },
  },
})
