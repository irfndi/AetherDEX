import { resolve } from "node:path"
import { TanStackRouterVite } from "@tanstack/router-plugin/vite"
import react from "@vitejs/plugin-react"
import { defineConfig, loadEnv } from "vite"

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "")
  if (mode === "production" && !env.VITE_API_URL && !process.env.VITE_API_URL) {
    throw new Error(
      "VITE_API_URL must be set for production builds (the http://localhost:8080 fallback must never ship)",
    )
  }

  return {
    plugins: [
      TanStackRouterVite({
        target: "react",
        autoCodeSplitting: true,
        routesDirectory: "./src/routes",
        generatedRouteTree: "./src/routeTree.gen.ts",
      }),
      react(),
    ],
    resolve: {
      alias: {
        "@": resolve(__dirname, "./src"),
      },
    },
    server: {
      host: "0.0.0.0",
      port: 3000,
    },
    build: {
      sourcemap: true,
      target: "es2025",
    },
  }
})
