import { test as base } from "@playwright/test"

/**
 * Shared E2E fixture.
 *
 * The web app's wallet provider (Reown AppKit / WalletConnect) and its data layer
 * (the `apps/api` Workers backend) both reach hosts that must NOT matter for these
 * UI smoke tests. Left alone they:
 *   - add variable external RTTs to app init (Reown config/usage/relay calls return
 *     403 with the placeholder project id), and
 *   - leave a WalletConnect relay connection in flight, which stops
 *     `waitForLoadState("networkidle")` from ever resolving.
 *
 * Aborting those requests makes init fail fast and deterministically (the app already
 * degrades gracefully on these paths), so tests exercise the rendered UI without
 * depending on the public internet or a running API.
 */
const BLOCKED_PATTERNS: RegExp[] = [
  // WalletConnect / Reown / Web3Modal cloud (relay, explorer, config, analytics).
  /walletconnect\.(com|org)/,
  /web3modal\.com/,
  /reown\.com/,
  // The backend API. Nothing listens on :8080 in E2E; abort instead of ECONNREFUSED so
  // React Query's failed fetches resolve instantly rather than driving a retry storm.
  /localhost:8080/,
]

export const test = base.extend({
  page: async ({ page }, use) => {
    await page.route(
      (url) => BLOCKED_PATTERNS.some((pattern) => pattern.test(url.href)),
      (route) => route.abort(),
    )
    await use(page)
  },
})

export { expect } from "@playwright/test"
