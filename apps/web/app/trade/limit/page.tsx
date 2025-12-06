"use client";

import { BackgroundTokens } from "@/components/BackgroundTokens";
import { Header } from "@/components/Header";

export default function LimitPage() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <Header onWalletConnect={() => {}} />
      <BackgroundTokens />
      <main className="pt-32 px-4">
        <div className="max-w-[480px] mx-auto text-center mb-8">
          <h1 className="text-5xl font-bold mb-4">Limit</h1>
        </div>
      </main>
    </div>
  );
}
