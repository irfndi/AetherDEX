import { createFileRoute } from '@tanstack/react-router'
import { Settings, ChevronDown } from 'lucide-react'
import { useState } from 'react'
import { useAccount, useConnect, useDisconnect, useWriteContract } from 'wagmi'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

// Address of the Router Contract (Placeholder)
const ROUTER_ADDRESS = '0x0000000000000000000000000000000000000000'

export const Route = createFileRoute('/trade/limit')({
    component: LimitPage,
})

function LimitPage() {
    const [amount, setAmount] = useState('')
    const [price, setPrice] = useState('')
    const { address, isConnected } = useAccount()
    const { connectors, connect } = useConnect()
    const { disconnect } = useDisconnect() // kept if needed
    const { writeContract, isPending } = useWriteContract()

    const handleConnect = () => {
        const connector = connectors[0]
        if (connector) {
            connect({ connector })
        }
    }

    const handlePlaceOrder = () => {
        if (!amount || !price) return
        console.log("Placing limit order:", amount, "@", price)
    }

    return (
        <div className="flex flex-col items-center justify-center min-h-[85vh] p-4 animate-float">
            <div className="w-full max-w-lg relative">
                {/* Glow Effect */}
                <div className="absolute inset-0 bg-primary/20 blur-[100px] rounded-full pointer-events-none" />

                <Card className="glass-card border-white/10 relative z-10">
                    <CardHeader className="flex flex-row items-center justify-between pb-4">
                        <CardTitle>Limit Order</CardTitle>
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground">
                            <Settings className="h-4 w-4" />
                        </Button>
                    </CardHeader>

                    <CardContent className="space-y-4">
                        {/* Amount Input */}
                        <div className="space-y-2 p-4 rounded-2xl bg-black/40 border border-white/5 hover:border-white/10 transition-colors">
                            <div className="flex justify-between text-sm text-muted-foreground">
                                <span>Amount</span>
                                <span>Balance: 0.0</span>
                            </div>
                            <div className="flex gap-4">
                                <input
                                    type="text"
                                    value={amount}
                                    onChange={(e) => setAmount(e.target.value)}
                                    placeholder="0"
                                    className="bg-transparent text-3xl font-medium outline-none w-full placeholder:text-muted-foreground/30"
                                />
                                <Button
                                    variant="secondary"
                                    className="rounded-xl gap-2 font-semibold min-w-[120px]"
                                >
                                    ETH
                                    <ChevronDown className="h-4 w-4 opacity-50" />
                                </Button>
                            </div>
                        </div>

                        {/* Price Input */}
                        <div className="space-y-2 p-4 rounded-2xl bg-black/40 border border-white/5 hover:border-white/10 transition-colors">
                            <div className="flex justify-between text-sm text-muted-foreground">
                                <span>Limit Price</span>
                                <span>Current: $0.00</span>
                            </div>
                            <div className="flex gap-4">
                                <input
                                    type="text"
                                    value={price}
                                    onChange={(e) => setPrice(e.target.value)}
                                    placeholder="0.00"
                                    className="bg-transparent text-3xl font-medium outline-none w-full placeholder:text-muted-foreground/30"
                                />
                                <span className="flex items-center text-lg font-medium text-muted-foreground px-4">
                                    USDC
                                </span>
                            </div>
                        </div>

                        {/* Action Buttons */}
                        {isConnected ? (
                            <Button
                                size="lg"
                                className="w-full text-lg font-semibold shadow-xl shadow-primary/20"
                                onClick={handlePlaceOrder}
                            >
                                Place Limit Order
                            </Button>
                        ) : (
                            <Button
                                size="lg"
                                className="w-full text-lg font-semibold"
                                onClick={handleConnect}
                            >
                                Connect Wallet to Order
                            </Button>
                        )}
                    </CardContent>
                </Card>
            </div>
        </div>
    )
}
