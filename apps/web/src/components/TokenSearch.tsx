import { Fragment, useCallback, useEffect, useRef, useState } from "react"
import { isValidAddress, shortenAddress } from "../lib/address"

export interface Token {
  address: string
  symbol: string
  name: string
  decimals: number
  logoURI?: string
}

interface TokenSearchProps {
  onSelect: (token: Token) => void
  selectedToken?: Token | null
  placeholder?: string
}

const DEFAULT_TOKENS: Token[] = [
  {
    address: "0x0000000000000000000000000000000000000000",
    symbol: "ETH",
    name: "Ether",
    decimals: 18,
    logoURI: "https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/info/logo.png",
  },
  {
    address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
    symbol: "USDC",
    name: "USD Coin",
    decimals: 6,
    logoURI:
      "https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48/logo.png",
  },
  {
    address: "0xdAC17F958D2ee523a2206206994597C13D831ec7",
    symbol: "USDT",
    name: "Tether USD",
    decimals: 6,
  },
  {
    address: "0x6B175474E89094C44Da98b954EedeAC495271d0F",
    symbol: "DAI",
    name: "Dai Stablecoin",
    decimals: 18,
  },
]

function TokenListItem({
  token,
  isSelected,
  onSelect,
}: {
  token: Token
  isSelected: boolean
  onSelect: () => void
}) {
  return (
    <li key={token.address}>
      <button type="button" className={`flex items-center gap-3 ${isSelected ? "active" : ""}`} onClick={onSelect}>
        {token.logoURI ? (
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

export function TokenSearch({ onSelect, selectedToken, placeholder = "Search token" }: TokenSearchProps) {
  const [query, setQuery] = useState("")
  const [isOpen, setIsOpen] = useState(false)
  const [results, setResults] = useState<Token[]>([])
  const [isSearching, setIsSearching] = useState(false)
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

  const searchTokens = useCallback(async (searchQuery: string) => {
    if (!searchQuery.trim()) {
      setResults(DEFAULT_TOKENS)
      setIsSearching(false)
      return
    }

    // If it's a valid address, search by address
    if (isValidAddress(searchQuery)) {
      setIsSearching(true)
      try {
        const found = DEFAULT_TOKENS.find((t) => t.address.toLowerCase() === searchQuery.toLowerCase())
        setResults(found ? [found] : [])
      } catch {
        setResults([])
      } finally {
        setIsSearching(false)
      }
      return
    }

      // Search by symbol or name
    setIsSearching(true)
    try {
      const filtered = DEFAULT_TOKENS.filter(
        (t) =>
          t.symbol.toLowerCase().includes(searchQuery.toLowerCase()) ||
          t.name.toLowerCase().includes(searchQuery.toLowerCase()),
      )
      setResults(filtered)
    } catch {
      setResults([])
    } finally {
      setIsSearching(false)
    }
  }, [])

  // Debounce effect
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
              DEFAULT_TOKENS.map((token) => (
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
