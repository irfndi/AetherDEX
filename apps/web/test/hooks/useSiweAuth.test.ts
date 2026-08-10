import { act, renderHook } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { useSiweAuth } from "../../src/hooks/useSiweAuth"

const { ADDRESS, SIGNATURE, disconnectMock } = vi.hoisted(() => ({
  ADDRESS: "0x1234567890123456789012345678901234567890",
  SIGNATURE: "0xsignature",
  disconnectMock: vi.fn(),
}))

vi.mock("wagmi", () => ({
  useAccount: () => ({ address: ADDRESS, chainId: 1, isConnected: true }),
  useDisconnect: () => ({ disconnect: disconnectMock }),
  useSignMessage: () => ({ signMessageAsync: vi.fn().mockResolvedValue(SIGNATURE) }),
}))

const FUTURE_MS = Date.now() + 24 * 60 * 60 * 1000
const PAST_MS = Date.now() - 1000

const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
  const url = String(input)
  if (url.includes("/auth/nonce")) {
    return new Response(JSON.stringify({ nonce: "nonce-123" }), { status: 200 })
  }
  if (url.includes("/auth/verify")) {
    return new Response(JSON.stringify({ token: "tok-123", userAddress: ADDRESS, expiresAt: FUTURE_MS }), {
      status: 200,
    })
  }
  if (url.includes("/auth/logout")) {
    return new Response(null, { status: 200 })
  }
  return new Response("not found", { status: 404 })
})

describe("useSiweAuth", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    sessionStorage.clear()
    disconnectMock.mockClear()
    fetchMock.mockClear()
  })

  it("stores the token in sessionStorage with its expiry", async () => {
    vi.stubGlobal("fetch", fetchMock)
    const { result } = renderHook(() => useSiweAuth())

    await act(async () => {
      await result.current.signIn()
    })

    expect(result.current.isAuthenticated).toBe(true)
    expect(sessionStorage.getItem("aetherdex-auth-token")).toBe("tok-123")
    expect(sessionStorage.getItem("aetherdex-auth-expires-at")).toBe(String(FUTURE_MS))
  })

  it("sends the stored token to /auth/logout while it is still valid", async () => {
    vi.stubGlobal("fetch", fetchMock)
    const { result } = renderHook(() => useSiweAuth())

    await act(async () => {
      await result.current.signIn()
    })
    fetchMock.mockClear()

    await act(async () => {
      await result.current.signOut()
    })

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/auth/logout"),
      expect.objectContaining({ headers: { Authorization: "Bearer tok-123" } }),
    )
    expect(sessionStorage.getItem("aetherdex-auth-token")).toBeNull()
    expect(disconnectMock).toHaveBeenCalledOnce()
  })

  it("treats an expired stored token as unauthenticated: no logout call, token dropped", async () => {
    vi.stubGlobal("fetch", fetchMock)
    const { result } = renderHook(() => useSiweAuth())

    await act(async () => {
      await result.current.signIn()
    })
    sessionStorage.setItem("aetherdex-auth-expires-at", String(PAST_MS))
    fetchMock.mockClear()

    await act(async () => {
      await result.current.signOut()
    })

    expect(fetchMock).not.toHaveBeenCalledWith(expect.stringContaining("/auth/logout"), expect.anything())
    expect(sessionStorage.getItem("aetherdex-auth-token")).toBeNull()
    expect(disconnectMock).toHaveBeenCalledOnce()
  })
})
