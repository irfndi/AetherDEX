"use client";

import { Header } from "@/components/Header";
import { BackgroundTokens } from "@/components/BackgroundTokens";

export default function BuyPage() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <Header onWalletConnect={() => {}} />
      <BackgroundTokens />
      <main className="pt-32 px-4">
        <div className="max-w-[480px] mx-auto text-center mb-8">
          <h1 className="text-5xl font-bold mb-4">Buy</h1>
        </div>
      </main>
    </div>
  );
}
