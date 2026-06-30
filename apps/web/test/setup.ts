import "@testing-library/jest-dom/vitest"
import { cleanup } from "@testing-library/react"
import { afterEach, vi } from "vitest"

const originalFetch = globalThis.fetch
globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url
  if (url.includes("dexscreener.com")) {
    return new Response("", { status: 200 })
  }
  return originalFetch(input as RequestInfo, init)
}) as typeof fetch

afterEach(() => {
  cleanup()
})
