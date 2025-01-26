"use client";

import React, { useState } from "react";
import type { Token } from "./TokenSelector";
import { ScrollArea } from "@radix-ui/react-scroll-area"; // Updated import path for ScrollArea

export interface TokenListProps { 
  tokens: Token[];
  onSelect: (token: Token) => void;
  isOpen: boolean; 
  onClose: () => void; 
}

export const TokenList = ({ tokens, onSelect, isOpen, onClose }: TokenListProps) => { 
  const [search, setSearch] = useState("");

  const filteredTokens = tokens.filter((token) =>
    token.name.toLowerCase().includes(search.toLowerCase()) || token.symbol.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <div className="w-full">
      <div className="p-2">
        <input
          type="search"
          placeholder="Search tokens..."
          className="w-full px-4 py-2 rounded-md bg-gray-800 border-none focus-visible:ring-0 focus-visible:ring-offset-0 text-sm text-gray-400"
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>
      <ScrollArea className="h-[300px] rounded-md border">
        <div className="space-y-2">
          {filteredTokens.map((token) => (
            <button // Added type="button"
              type="button"
              key={token.symbol}
              className="flex items-center px-2 py-2.5 rounded-sm w-full hover:bg-gray-700/50 focus:bg-gray-700/50 focus:outline-none disabled:opacity-50 data-[state=open]:bg-gray-700/50"
              onClick={() => {
                onSelect(token);
              }}
            >
              <img src={token.icon || "/placeholder.svg"} alt={token.name} className="w-8 h-8" />
              <div className="flex-1 text-left">
                <p className="text-sm font-semibold">{token.name}</p>
                <p className="text-xs text-gray-400">{token.symbol}</p>
              </div>
            </button>
          ))}
        </div>
      </ScrollArea>
    </div>
  );
};
