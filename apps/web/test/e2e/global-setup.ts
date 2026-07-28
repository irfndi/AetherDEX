/**
 * Playwright global setup — Vite dev-server warm-up.
 *
 * Why this exists: the E2E suite runs against the Vite dev server (`bun run dev`).
 * The FIRST request after boot is slow two ways:
 *   1. Vite's dependency pre-bundling (esbuild `optimizeDeps`) runs once and blocks
 *      module requests until complete (measured ~12s on this app's heavy wagmi /
 *      reown / uniswap-sdk dependency graph).
 *   2. The entry module and its import graph are transformed on demand.
 *
 * When a test pays that cost inside `page.goto`, it can exceed the per-navigation
 * timeout, and with parallel workers the compounding transforms turn it into a flaky
 * "Test timeout exceeded" failure. We pay it once, out of band, here — where there is
 * no test timeout — so every test then loads a fully warmed server in ~1s.
 */

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3000"

// Routes exercised by the specs, plus the Vite entry module. Fetching the entry
// (/src/main.tsx) forces Vite to transform the root of the import graph and to
// finish/optimize the pre-bundled dependency chunks that the browser will request.
const WARM_TARGETS = ["/src/main.tsx", "/", "/swap", "/pools", "/pools/new", "/positions", "/portfolio", "/playground"]

const READY_TIMEOUT_MS = 120_000
const FETCH_TIMEOUT_MS = 90_000

async function waitForServer(): Promise<void> {
  const deadline = Date.now() + READY_TIMEOUT_MS
  let lastError: unknown
  while (Date.now() < deadline) {
    try {
      const res = await fetch(BASE_URL, { signal: AbortSignal.timeout(5_000) })
      if (res.ok || res.status === 304) return
      lastError = new Error(`non-ready status ${res.status}`)
    } catch (error) {
      lastError = error
    }
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  throw new Error(
    `Vite dev server did not become ready at ${BASE_URL} within ${READY_TIMEOUT_MS}ms: ${String(lastError)}`,
  )
}

async function warm(target: string): Promise<void> {
  try {
    await fetch(`${BASE_URL}${target}`, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
  } catch {
    // Best-effort: warming only. A failed warm (e.g. an HTML fallback) must not fail
    // the run — the tests themselves still assert the real behaviour with retries.
  }
}

export default async function globalSetup(): Promise<void> {
  await waitForServer()
  // Warm sequentially enough to let optimizeDeps finish, then the rest can race.
  await warm("/src/main.tsx")
  await warm("/")
  await Promise.all(WARM_TARGETS.slice(2).map(warm))
}
