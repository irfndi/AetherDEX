"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { createConfig, http, WagmiProvider } from "wagmi";
import { polygonZkEvmTestnet } from "wagmi/chains";
import { Header } from "@/components/features/common/Header";
import { ThemeProvider } from "@/components/ui/theme-provider";
import { Toaster } from "@/components/ui/toaster";

const config = createConfig({
  chains: [polygonZkEvmTestnet],
  transports: {
    [polygonZkEvmTestnet.id]: http(),
  },
});

const queryClient = new QueryClient();

export function Providers({ children }: { children: React.ReactNode }) {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
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
