"use client";

import { useState } from "react";
import { Header } from "@/components/Header";
import { ThemeProvider } from "@/components/ui/theme-provider";
import { Toaster } from "@/components/ui/toaster";
import { WagmiProvider, createConfig, http } from "wagmi";
import { polygonZkEvmTestnet } from "wagmi/chains";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const config = createConfig({
  chains: [polygonZkEvmTestnet],
  transports: {
    [polygonZkEvmTestnet.id]: http(),
  },
});

const queryClient = new QueryClient();

export function Providers({ children }: { children: React.ReactNode }) {
  const [_walletAddress, setWalletAddress] = useState("");

  const handleWalletConnect = (address: string) => {
    setWalletAddress(address);
  };

  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
          <Header onWalletConnect={handleWalletConnect} />
          {children}
          <Toaster />
        </ThemeProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}