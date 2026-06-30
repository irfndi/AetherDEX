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
      provider: "v8",
      reporter: ["text", "html", "lcov"],
      thresholds: {
        statements: 70,
        branches: 70,
        functions: 70,
        lines: 70,
      },
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.d.ts", "src/**/*.test.ts"],
    },
  },
})
