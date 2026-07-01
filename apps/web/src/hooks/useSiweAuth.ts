import { useCallback, useState } from "react"
import { useAccount, useDisconnect, useSignMessage } from "wagmi"

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
      const nonceRes = await fetch(`${import.meta.env.VITE_API_URL ?? "http://localhost:8080"}/api/v1/auth/nonce`)
      if (!nonceRes.ok) throw new Error("Failed to fetch nonce")
      const { nonce } = (await nonceRes.json()) as { nonce: string }

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
      ].join("\n")

      // 3. Sign with wallet
      const signature = await signMessageAsync({ message })

      // 4. Send to server for verification
      const verifyRes = await fetch(`${import.meta.env.VITE_API_URL ?? "http://localhost:8080"}/api/v1/auth/verify`, {
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

      const { token, userAddress } = JSON.parse(responseText) as {
        token: string
        userAddress: string
      }

      // 5. Store token
      localStorage.setItem("aetherdex-auth-token", token)

      setState({ isAuthenticated: true, userAddress, token, loading: false })
    } catch (err) {
      setState((s) => ({ ...s, loading: false, error: String(err) }))
    }
  }, [address, chainId, signMessageAsync])

  const signOut = useCallback(async () => {
    const token = localStorage.getItem("aetherdex-auth-token")
    if (token) {
      try {
        await fetch(`${import.meta.env.VITE_API_URL ?? "http://localhost:8080"}/api/v1/auth/logout`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
        })
      } catch {
        // Ignore errors on logout
      }
    }
    localStorage.removeItem("aetherdex-auth-token")
    disconnect()
    setState({ isAuthenticated: false, loading: false })
  }, [disconnect])

  return { ...state, signIn, signOut, isConnected }
}
