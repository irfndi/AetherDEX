import { useState } from "react";
import { Header } from "@/components/Header";
import { ThemeProvider } from "@/components/ui/theme-provider";
import { Toaster } from "@/components/ui/toaster";
import { Inter } from "next/font/google";
import "./globals.css";

import { WagmiConfig, createConfig, http } from "wagmi";
import { configureChains } from "@wagmi/core";
import { polygonZkEvmTestnet } from "wagmi/chains";
import { publicProvider } from "@wagmi/core/providers/public";

const { chains } = configureChains([polygonZkEvmTestnet], [publicProvider()]);

const config = createConfig({
  chains,
  transports: {
    [polygonZkEvmTestnet.id]: http(),
  },
});

const inter = Inter({ subsets: ["latin"] });

export const metadata = {
  title: "Aether DEX",
  description: "Decentralized Exchange Platform",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const [walletAddress, setWalletAddress] = useState("");

  const handleWalletConnect = (address: string) => {
    setWalletAddress(address);
  };

  return (
    <html lang="en" suppressHydrationWarning className="dark">
      <body className={`${inter.className}`} style={{ backgroundColor: "lightblue" }}>
        <WagmiConfig config={config}>
          <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
            <Header onWalletConnect={handleWalletConnect} />
            {children}
            <Toaster />
          </ThemeProvider>
        </WagmiConfig>
      </body>
    </html>
  );
}
