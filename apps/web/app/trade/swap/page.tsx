"use client";

import { ArrowDown } from "lucide-react";
import { useState } from "react";
import { BackgroundTokens } from "@/components/features/common/BackgroundTokens";
import { Header } from "@/components/features/common/Header";
import type { Token } from "@/components/features/trade/TokenSelector"; // Updated import path for Token
import { TokenSelector } from "@/components/features/trade/TokenSelector";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export default function SwapPage() {
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
  const [isWalletConnected, setIsWalletConnected] = useState(false);

  const handleSwap = () => {
    const temp = fromToken;
    if (toToken) setFromToken(toToken);
    setToToken(temp);
    setFromAmount(toAmount);
    setToAmount(fromAmount);
  };

  const calculateToAmount = (value: string) => {
    setFromAmount(value);
    if (fromToken && toToken && value) {
      const fromValue = Number.parseFloat(value);
      let exchangeRate: number | undefined;
      if (fromToken.price !== undefined && toToken.price !== undefined) {
        exchangeRate = fromToken.price / toToken.price;
        setToAmount((fromValue * exchangeRate).toFixed(6));
      } else {
        setToAmount("");
      }
    } else {
      setToAmount("");
    }
  };

  const calculateFromAmount = (value: string) => {
    setToAmount(value);
    if (fromToken && toToken && value) {
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
    <div className="min-h-screen bg-background text-foreground">
      <Header onWalletConnect={(address) => setIsWalletConnected(!!address)} />
      <BackgroundTokens />
      <main className="pt-32 px-4">
        <div className="max-w-[480px] mx-auto text-center mb-8">
          <h1 className="text-5xl font-bold mb-4">Swap tokens instantly</h1>
          <p className="text-muted-foreground">
            Trade any combination of tokens with the best rates and lowest fees.
          </p>
        </div>
        <div className="w-full max-w-[480px] mx-auto bg-card rounded-2xl p-4">
          <div className="space-y-4">
            <div className="p-4 bg-muted rounded-xl">
              <div className="flex justify-between mb-2">
                <span className="text-sm text-muted-foreground">Sell</span>
                <span className="text-sm text-muted-foreground">
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
              <div className="text-sm text-right text-muted-foreground mt-1">
                $
                {fromToken && fromAmount
                  ? (Number.parseFloat(fromAmount) * (fromToken.price ?? 0)).toFixed(
                    // Use optional chaining and default value
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
            <div className="p-4 bg-muted rounded-xl">
              <div className="flex justify-between mb-2">
                <span className="text-sm text-muted-foreground">Buy</span>
                <span className="text-sm text-muted-foreground">
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
              <div className="text-sm text-right text-muted-foreground mt-1">
                $
                {toToken && toAmount
                  ? (Number.parseFloat(toAmount) * (toToken.price ?? 0)).toFixed(2) // Use optional chaining and default value
                  : "0.00"}
              </div>
            </div>
          </div>
          <Button
            className="w-full mt-4 bg-aether hover:bg-aether/90 text-aether-foreground h-14 text-base font-semibold rounded-xl"
            disabled={!fromToken || !toToken || !fromAmount || !toAmount}
            onClick={() => {
              if (!isWalletConnected) {
                // Trigger wallet connection
                (
                  document.querySelector('button:contains("Connect Wallet")') as HTMLElement
                )?.click();
              } else {
                // Perform swap
                console.log("Swap performed");
              }
            }}
          >
            {!isWalletConnected ? "Get Started" : !fromToken || !toToken ? "Select tokens" : "Swap"}
          </Button>
        </div>
      </main>
    </div>
  );
}
