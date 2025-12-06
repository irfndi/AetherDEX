"use client";

"use client";

"use client";

import { useEffect } from "react";
import { useAccount, useConnect, useDisconnect } from "wagmi";
import { injected } from "wagmi/connectors";
import { Button } from "./ui/button";

export function WalletConnect({ onConnected }: { onConnected: (address: string) => void }) {
  const { address, isConnected } = useAccount();
  const { connect } = useConnect();
  const { disconnect } = useDisconnect();

  useEffect(() => {
    if (isConnected && address) {
      onConnected(address);
    } else {
      onConnected("");
    }
  }, [isConnected, address, onConnected]);

  return (
    <Button
      onClick={() => (isConnected ? disconnect() : connect({ connector: injected() }))}
      className={
        isConnected
          ? "bg-gray-800 hover:bg-gray-700"
          : "bg-aether hover:bg-aether/90 text-aether-foreground"
      }
    >
      {isConnected ? `${address?.slice(0, 6)}...${address?.slice(-4)}` : "Connect Wallet"}
    </Button>
  );
}
