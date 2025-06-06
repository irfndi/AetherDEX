"use client";

import { useState } from "react";
import { ArrowDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Header } from "@/components/Header";
import { TokenSelector } from "@/components/TokenSelector";
import { BackgroundTokens } from "@/components/BackgroundTokens";
import type { Token } from "@/components/TokenSelector"; 

export default function Home() {
  const [fromToken, setFromToken] = useState<Token>({
    symbol: "ETH",
    name: "Ethereum",
    icon: "/placeholder.svg?height=32&width=32",
    balance: "0.0",
    price: 2000,
  });
  const [toToken, setToToken] = useState<Token>();
  const [fromAmount, setFromAmount] = useState("");
  const [toAmount, setToAmount] = useState("");

  const handleSwap = () => {
    const temp = fromToken;
    if (toToken) {
      setFromToken(toToken);
    }
    setToToken(temp);
    setFromAmount(toAmount);
    setToAmount(fromAmount);
  };

  const calculateToAmount = (value: string) => {
    setFromAmount(value);
    if (fromToken && toToken && value) {
      const fromValue = Number.parseFloat(value);
      let exchangeRate: number | undefined;
      if (fromToken && toToken && fromToken.price !== undefined && toToken.price !== undefined) {
        exchangeRate = fromToken.price / toToken.price;
        setToAmount((fromValue * exchangeRate).toFixed(6));
      } else {
        setToAmount("");
      }
    } 
  };

  const calculateFromAmount = (value: string) => {
    setToAmount(value);
    if (fromToken && toToken && value) {
      const toValue = Number.parseFloat(value);
      let exchangeRate: number | undefined;
      if (toToken.price !== undefined && fromToken.price !== undefined) {
        exchangeRate = toToken.price / fromToken.price;
        setFromAmount((Number.parseFloat(value) * exchangeRate).toFixed(6));
      } else {
        setFromAmount("");
      }
    } else {
      setFromAmount("");
    }
  };

  return (
    <div className="min-h-screen text-foreground" style={{ backgroundColor: 'lightgreen' }}>
      <Header
        onWalletConnect={(address) => console.log("Connected:", address)}
      />
      <BackgroundTokens />
      <main className="pt-32 px-4">
        <div className="max-w-[480px] mx-auto text-center mb-8">
          <h1 className="text-5xl font-bold mb-4">Swap anytime, anywhere.</h1>
          <p className="text-gray-400">
            The largest onchain marketplace. Buy and sell crypto on Ethereum and
            11+ other chains.
          </p>
        </div>
        <div className="w-full max-w-[480px] mx-auto bg-card rounded-2xl p-4">
          <div className="space-y-4">
            <div className="p-4 bg-gray-800 rounded-xl">
              <div className="flex justify-between mb-2">
                <span className="text-sm text-gray-400">Sell</span>
                <span className="text-sm text-gray-400">
                  Balance: {fromToken?.balance} {fromToken?.symbol}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <Input
                  type="text"
                  placeholder="0"
                  value={fromAmount}
                  onChange={(e) => calculateToAmount(e.target.value)}
                  className="border-0 bg-transparent text-2xl font-medium focus-visible:ring-0 p-0 h-auto"
                />
                <TokenSelector tokens={[]} token={fromToken} onSelect={setFromToken} /> 
              </div>
              <div className="text-sm text-right text-gray-400 mt-1">
                $
                {fromToken && fromAmount
                  ? (Number.parseFloat(fromAmount) * (fromToken.price ?? 0)).toFixed(
                      2,
                    )
                  : "0.00"}
              </div>
            </div>
            <div className="flex justify-center -my-2 relative z-10">
              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8 rounded-full border-border bg-background"
                onClick={handleSwap}
              >
                <ArrowDown className="h-4 w-4" />
              </Button>
            </div>
            <div className="p-4 bg-gray-800 rounded-xl">
              <div className="flex justify-between mb-2">
                <span className="text-sm text-gray-400">Buy</span>
                <span className="text-sm text-gray-400">
                  Balance: {toToken?.balance ?? "0"} {toToken?.symbol ?? ""}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <Input
                  type="text"
                  placeholder="0"
                  value={toAmount}
                  onChange={(e) => calculateFromAmount(e.target.value)}
                  className="border-0 bg-transparent text-2xl font-medium focus-visible:ring-0 p-0 h-auto"
                />
                <TokenSelector tokens={[]} token={toToken} onSelect={setToToken} /> 
              </div>
              <div className="text-sm text-right text-gray-400 mt-1">
                $
                {toToken && toAmount
                  ? (Number.parseFloat(toAmount) * (toToken.price ?? 0)).toFixed(2)
                  : "0.00"}
              </div>
            </div>
          </div>
          <Button
            className="w-full mt-4 bg-aether hover:bg-aether/90 text-aether-foreground h-14 text-base font-semibold rounded-xl"
            disabled={!fromToken || !toToken || !fromAmount || !toAmount}
          >
            {!fromToken || !toToken ? "Select tokens" : "Swap"}
          </Button>
        </div>
      </main>
    </div>
  );
}
