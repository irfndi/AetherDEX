import { resolve } from "node:path"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vitest/config"

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "happy-dom",
    setupFiles: ["./test/setup.ts"],
    include: ["test/**/*.{test,spec}.{ts,tsx}"],
    exclude: ["test/e2e/**", "node_modules/**"],
    dangerouslyIgnoreUnhandledErrors: true,
    coverage: {
      provider: "istanbul",
      reporter: ["text", "html", "lcov"],
      thresholds: {
        statements: 70,
        branches: 70,
        functions: 70,
        lines: 70,
      },
      include: ["src/**/*.{ts,tsx}"],
      exclude: ["src/**/*.d.ts", "src/**/*.test.{ts,tsx}", "src/routeTree.gen.ts"],
    },
  },
  resolve: {
    alias: {
      "@": resolve(__dirname, "./src"),
    },
  },
})
