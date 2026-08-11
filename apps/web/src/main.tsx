import { QueryClientProvider } from "@tanstack/react-query"
import { createRouter, RouterProvider } from "@tanstack/react-router"
import { MotionConfig } from "framer-motion"
import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { applyStoredTheme } from "./lib/theme"
import { queryClient } from "./query-client"
import { routeTree } from "./routeTree.gen"
import { AppKitProvider } from "./wagmi"
import "./index.css"

// Set <html data-theme> from localStorage before React mounts to avoid a flash
// of the default theme on reload.
applyStoredTheme()

const router = createRouter({ routeTree })

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router
  }
}

const rootEl = document.getElementById("root")
if (!rootEl) throw new Error("Root element not found")

createRoot(rootEl).render(
  <StrictMode>
    <MotionConfig reducedMotion="user">
      <AppKitProvider>
        <QueryClientProvider client={queryClient}>
          <RouterProvider router={router} />
        </QueryClientProvider>
      </AppKitProvider>
    </MotionConfig>
  </StrictMode>,
)
