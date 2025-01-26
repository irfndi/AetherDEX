"use client"

import { useState } from "react"
import { Button } from "./ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"

export function WalletConnect({ onConnected }: { onConnected: (address: string) => void }) {
  const [isOpen, setIsOpen] = useState(false)
  const [isConnected, setIsConnected] = useState(false)
  const [address, setAddress] = useState("")

  const connectWallet = async () => {
    // Simulate wallet connection
    const newAddress = "0xb7...3ad"
    setAddress(newAddress)
    setIsConnected(true)
    setIsOpen(false)
    onConnected(newAddress)
  }

  const disconnectWallet = () => {
    setAddress("")
    setIsConnected(false)
    onConnected("")
  }

  return (
    <>
      <Button
        onClick={() => (isConnected ? disconnectWallet() : setIsOpen(true))}
        className={
          isConnected ? "bg-gray-800 hover:bg-gray-700" : "bg-aether hover:bg-aether/90 text-aether-foreground"
        }
      >
        {isConnected ? address : "Connect Wallet"}
      </Button>

      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogContent className="bg-background border-border">
          <DialogHeader>
            <DialogTitle className="text-xl font-bold">Connect Wallet</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <Button
              onClick={connectWallet}
              className="flex items-center gap-3 h-14 text-left px-4 bg-secondary hover:bg-secondary/80"
            >
              <img src="/placeholder.svg?height=32&width=32" className="h-8 w-8" alt="MetaMask" />
              <div>
                <div className="font-semibold">MetaMask</div>
                <div className="text-sm text-gray-400">Connect to your MetaMask Wallet</div>
              </div>
            </Button>
            <Button
              onClick={connectWallet}
              className="flex items-center gap-3 h-14 text-left px-4 bg-secondary hover:bg-secondary/80"
            >
              <img src="/placeholder.svg?height=32&width=32" className="h-8 w-8" alt="WalletConnect" />
              <div>
                <div className="font-semibold">WalletConnect</div>
                <div className="text-sm text-gray-400">Connect with WalletConnect</div>
              </div>
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}

