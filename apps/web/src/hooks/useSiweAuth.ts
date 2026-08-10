import { useCallback, useState } from "react"
import { useAccount, useDisconnect, useSignMessage } from "wagmi"

const API_URL = (import.meta.env.VITE_API_URL ?? "http://localhost:8080/api/v1").replace(/\/$/, "")

const TOKEN_KEY = "aetherdex-auth-token"
const TOKEN_EXPIRES_KEY = "aetherdex-auth-expires-at"

/**
 * The session token lives in sessionStorage (dies with the tab) with an
 * expiry mirroring the server session; an expired stored token is treated
 * as unauthenticated instead of being sent to the API.
 */
function readStoredToken(): string | null {
  const token = sessionStorage.getItem(TOKEN_KEY)
  if (!token) return null
  const expiresAt = Number(sessionStorage.getItem(TOKEN_EXPIRES_KEY) ?? 0)
  if (expiresAt > 0 && expiresAt <= Date.now()) {
    sessionStorage.removeItem(TOKEN_KEY)
    sessionStorage.removeItem(TOKEN_EXPIRES_KEY)
    return null
  }
  return token
}

function clearStoredToken() {
  sessionStorage.removeItem(TOKEN_KEY)
  sessionStorage.removeItem(TOKEN_EXPIRES_KEY)
}

export interface AuthState {
  isAuthenticated: boolean
  userAddress?: string
  token?: string
  loading: boolean
  error?: string | undefined
}

export function useSiweAuth() {
  const { address, chainId, isConnected } = useAccount()
  const { signMessageAsync } = useSignMessage()
  const { disconnect } = useDisconnect()
  const [state, setState] = useState<AuthState>({
    isAuthenticated: false,
    loading: false,
  })

  const signIn = useCallback(async () => {
    if (!address || !chainId) {
      setState((s) => ({ ...s, error: "Wallet not connected", loading: false }))
      return
    }

    setState((s) => ({ ...s, loading: true, error: undefined }))

    try {
      // 1. Get nonce from server
      const nonceRes = await fetch(`${API_URL}/auth/nonce`)
      if (!nonceRes.ok) throw new Error("Failed to fetch nonce")
      const { nonce, issuedAt } = (await nonceRes.json()) as { nonce: string; issuedAt: string }

      // 2. Build SIWE message
      const message = [
        `${window.location.host} wants you to sign in with your Ethereum account:`,
        address,
        "",
        "Sign in to AetherDEX",
        "",
        `URI: ${window.location.origin}`,
        "Version: 1",
        `Chain ID: ${chainId}`,
        `Nonce: ${nonce}`,
        `Issued At: ${issuedAt}`,
      ].join("\n")

      // 3. Sign with wallet
      const signature = await signMessageAsync({ message })

      // 4. Send to server for verification
      const verifyRes = await fetch(`${API_URL}/auth/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message, signature }),
      })

      const responseText = await verifyRes.text()
      if (!verifyRes.ok) {
        try {
          const err = JSON.parse(responseText) as { error: string }
          throw new Error(err.error ?? "Verification failed")
        } catch {
          throw new Error(`Verification failed: ${verifyRes.status}`)
        }
      }

      const { token, userAddress, expiresAt } = JSON.parse(responseText) as {
        token: string
        userAddress: string
        expiresAt: number
      }

      // 5. Store token with its server-side expiry; sessionStorage so it does
      // not survive the tab (localStorage was script-readable forever).
      sessionStorage.setItem(TOKEN_KEY, token)
      sessionStorage.setItem(TOKEN_EXPIRES_KEY, String(expiresAt))

      setState({ isAuthenticated: true, userAddress, token, loading: false })
    } catch (err) {
      setState((s) => ({ ...s, loading: false, error: String(err) }))
    }
  }, [address, chainId, signMessageAsync])

  const signOut = useCallback(async () => {
    const token = readStoredToken()
    if (token) {
      try {
        await fetch(`${API_URL}/auth/logout`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
        })
      } catch {
        // Ignore errors on logout
      }
    }
    clearStoredToken()
    disconnect()
    setState({ isAuthenticated: false, loading: false })
  }, [disconnect])

  return { ...state, signIn, signOut, isConnected }
}
