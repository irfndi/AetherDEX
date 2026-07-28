import { defineConfig, devices } from "@playwright/test"

export default defineConfig({
  testDir: "./test/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  // Dev-mode browsers each evaluate the heavy (unminified) dep graph, so concurrent
  // cold mounts contend for CPU. Serialising in CI (1 worker) keeps it deterministic
  // there; locally a small worker count bounds contention without a long run.
  workers: process.env.CI ? 1 : 2,
  // Pay Vite's one-time dep pre-bundle + entry transform once, out of band, before any
  // test loads a page — otherwise the first browser navigation pays cold-compile cost.
  globalSetup: "./test/e2e/global-setup.ts",
  reporter: [["html", { open: "never" }], ["list"]],
  use: {
    baseURL: "http://localhost:3000",
    trace: "on-first-retry",
    // In dev mode React mounts asynchronously ~1-4s AFTER the `load` event that
    // `page.goto` waits on (#root is empty at `load`). These are retry *bounds* for
    // that async mount under worker contention — not sleeps; passing tests finish in
    // ~1-3s. Without this headroom, first-mount races the element locators and flakes.
    navigationTimeout: 45_000,
    actionTimeout: 25_000,
  },
  timeout: 90_000,
  expect: {
    timeout: 25_000,
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: "bun run dev",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      ...process.env,
      VITE_API_URL: process.env.VITE_API_URL ?? "http://localhost:8080/api/v1",
      VITE_REOWN_PROJECT_ID: process.env.VITE_REOWN_PROJECT_ID ?? "e2e-placeholder-project-id",
    },
  },
})
