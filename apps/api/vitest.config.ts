import { resolve } from "node:path"
import { cloudflareTest } from "@cloudflare/vitest-pool-workers"
import { defineConfig } from "vitest/config"

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: resolve(__dirname, "./wrangler.jsonc") },
      miniflare: {
        compatibilityFlags: ["nodejs_compat"],
      },
    }),
  ],
  test: {
    setupFiles: ["./test/setup.ts"],
    server: {
      deps: {
        inline: ["siwe", "@reown/appkit", "@reown/appkit-adapter-wagmi"],
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
