"use client"

import { useState } from "react"
import { ChevronDown } from "lucide-react"
import { Button } from "./ui/button"
import { TokenList } from "./TokenList"

export interface Token { // Moved Token interface definition here and exported it
  symbol: string
  name: string
  icon: string | null | undefined
  balance: string | null | undefined
  price?: number
}

interface TokenSelectorProps {
  tokens: Token[]; // Added tokens prop to TokenSelectorProps
  token?: Token
  onSelect: (token: Token) => void
  className?: string
}

export function TokenSelector({ tokens, token, onSelect, className = "" }: TokenSelectorProps) { // Updated component props to accept tokens
  const [isOpen, setIsOpen] = useState(false)

  const handleSelect = (selectedToken: Token) => {
    onSelect(selectedToken)
    setIsOpen(false)
  }

  if (!token) {
    return (
      <>
        <Button
          onClick={() => setIsOpen(true)}
          variant="ghost"
          className={`h-9 px-3 font-semibold bg-aether/20 text-aether hover:bg-aether/30 rounded-full ${className}`}
        >
          Select token
          <ChevronDown className="ml-2 h-4 w-4" />
        </Button>
        {isOpen && <TokenList tokens={tokens} onSelect={handleSelect} />}
      </>
    )
  }

  return (
    <>
      <Button
        onClick={() => setIsOpen(true)}
        variant="ghost"
        className={`h-9 gap-2 px-3 font-semibold hover:bg-secondary/80 rounded-full ${className}`}
      >
        <img src={token.icon || "/placeholder.svg"} alt={token.symbol} className="w-5 h-5" />
        {token.symbol}
        <ChevronDown className="h-4 w-4" />
      </Button>
      {isOpen && <TokenList tokens={tokens} onSelect={handleSelect} />}
    </>
  )
}
