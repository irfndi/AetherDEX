import type { Token as DefaultListToken } from "@aetherdex/shared"
import { Effect } from "effect"
import { Fragment, useCallback, useEffect, useRef, useState } from "react"
import { isValidAddress, shortenAddress } from "../lib/address"
import { fetchTokenByAddress, fetchTokens } from "../lib/api"

export interface Token {
  address: string
  symbol: string
  name: string
  decimals: number
  logoURI?: string
}

function toToken(t: DefaultListToken): Token {
  return {
    address: t.address,
    symbol: t.symbol,
    name: t.name,
    decimals: t.decimals,
    ...(t.logoUrl ? { logoURI: t.logoUrl } : {}),
  }
}

interface TokenSearchProps {
  onSelect: (token: Token) => void
  selectedToken?: Token | null
  placeholder?: string
}

const ALLOWED_IMAGE_HOSTS = new Set([
  "raw.githubusercontent.com",
  "assets.coingecko.com",
  "tokens.1inch.io",
  "cdn.dexscreener.com",
])

function isSafeImageUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== "https:") return false
    return ALLOWED_IMAGE_HOSTS.has(parsed.hostname)
  } catch {
    return false
  }
}

const DEFAULT_LIST_LIMIT = 100

function TokenListItem({ token, isSelected, onSelect }: { token: Token; isSelected: boolean; onSelect: () => void }) {
  return (
    <li key={token.address}>
      <button type="button" className={`flex items-center gap-3 ${isSelected ? "active" : ""}`} onClick={onSelect}>
        {token.logoURI && isSafeImageUrl(token.logoURI) ? (
          <img src={token.logoURI} alt={token.symbol} className="h-6 w-6 rounded-full" />
        ) : (
          <div className="avatar placeholder">
            <div className="bg-base-300 h-6 w-6 rounded-full text-[10px]">
              <span>{token.symbol.slice(0, 2)}</span>
            </div>
          </div>
        )}
        <div className="flex flex-col items-start">
          <span className="font-semibold">{token.symbol}</span>
          <span className="text-xs text-base-content/50">
            {token.address === "0x0000000000000000000000000000000000000000"
              ? token.name
              : `${token.name} \u00B7 ${shortenAddress(token.address, 4)}`}
          </span>
        </div>
      </button>
    </li>
  )
}

/**
 * Token search backed by the API's `/tokens` endpoint — the canonical Uniswap
 * default token list (server-validated + chainId-filtered). No hardcoded or
 * custom-curated lists.
 */
export function TokenSearch({ onSelect, selectedToken, placeholder = "Search token" }: TokenSearchProps) {
  const [query, setQuery] = useState("")
  const [isOpen, setIsOpen] = useState(false)
  const [results, setResults] = useState<Token[]>([])
  const [defaultTokens, setDefaultTokens] = useState<Token[]>([])
  const [isSearching, setIsSearching] = useState(false)
  const defaultsLoadedRef = useRef(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }
    document.addEventListener("mousedown", handleClickOutside)
    return () => document.removeEventListener("mousedown", handleClickOutside)
  }, [])

  // Load the default-list top tokens once, when the picker first opens.
  // Mark "loaded" only after a RETAINED successful response — on failure or on
  // unmount/cancel the flag stays unset so reopening the picker retries instead of
  // showing an empty default list for the component's lifetime.
  useEffect(() => {
    if (!isOpen || defaultsLoadedRef.current) return
    let cancelled = false
    Effect.runPromise(fetchTokens({ limit: DEFAULT_LIST_LIMIT }))
      .then((res) => {
        if (cancelled) return
        defaultsLoadedRef.current = true
        setDefaultTokens(res.tokens.map(toToken))
      })
      .catch(() => {
        if (!cancelled) setDefaultTokens([])
      })
    return () => {
      cancelled = true
    }
  }, [isOpen])

  const searchTokens = useCallback(async (searchQuery: string) => {
    if (!searchQuery.trim()) {
      setResults([])
      setIsSearching(false)
      return
    }

    setIsSearching(true)
    try {
      if (isValidAddress(searchQuery)) {
        const found = await Effect.runPromise(fetchTokenByAddress(searchQuery))
        setResults(found ? [toToken(found)] : [])
        return
      }
      const res = await Effect.runPromise(fetchTokens({ query: searchQuery, limit: 50 }))
      setResults(res.tokens.map(toToken))
    } catch {
      setResults([])
    } finally {
      setIsSearching(false)
    }
  }, [])

  useEffect(() => {
    setIsSearching(true)
    const timer = setTimeout(() => {
      searchTokens(query)
    }, 300)
    return () => clearTimeout(timer)
  }, [query, searchTokens])

  const handleSelect = (token: Token) => {
    onSelect(token)
    setQuery("")
    setIsOpen(false)
    setResults([])
  }

  return (
    <div ref={containerRef} className="relative">
      <div className="join w-full">
        <button
          type="button"
          className="btn btn-outline join-item gap-2 min-w-[120px] justify-start"
          onClick={() => {
            setIsOpen(!isOpen)
            inputRef.current?.focus()
          }}
        >
          {selectedToken ? (
            <Fragment>
              {selectedToken.logoURI && (
                <img src={selectedToken.logoURI} alt={selectedToken.symbol} className="h-5 w-5 rounded-full" />
              )}
              <span className="font-semibold">{selectedToken.symbol}</span>
            </Fragment>
          ) : (
            <span className="text-base-content/50">Select token</span>
          )}
        </button>
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setIsOpen(true)
          }}
          onFocus={() => setIsOpen(true)}
          placeholder={placeholder}
          className="input input-bordered join-item flex-1"
        />
      </div>

      {isOpen && (
        <div className="absolute z-50 mt-1 w-full rounded-box border border-base-300 bg-base-100 shadow-lg">
          <ul className="menu max-h-60 overflow-y-auto p-2">
            {isSearching && query.trim() && (
              <li className="disabled">
                <span className="loading loading-spinner loading-sm" />
                Searching...
              </li>
            )}

            {!isSearching && results.length === 0 && query.trim() && (
              <li className="disabled">
                <span className="text-base-content/50">No tokens found</span>
              </li>
            )}

            {results.map((token) => (
              <TokenListItem
                key={token.address}
                token={token}
                isSelected={selectedToken?.address === token.address}
                onSelect={() => handleSelect(token)}
              />
            ))}

            {!query.trim() &&
              defaultTokens.map((token) => (
                <TokenListItem
                  key={token.address}
                  token={token}
                  isSelected={selectedToken?.address === token.address}
                  onSelect={() => handleSelect(token)}
                />
              ))}
          </ul>
        </div>
      )}
    </div>
  )
}
