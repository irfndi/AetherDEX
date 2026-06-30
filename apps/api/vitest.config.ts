import { defineWorkersConfig } from "@cloudflare/vitest-pool-workers/config"
import { resolve } from "node:path"

export default defineWorkersConfig({
  test: {
    setupFiles: ["./test/setup.ts"],
    poolOptions: {
      workers: {
        wrangler: { configPath: resolve(__dirname, "./wrangler.jsonc") },
        miniflare: {
          compatibilityFlags: ["nodejs_compat"],
        },
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
