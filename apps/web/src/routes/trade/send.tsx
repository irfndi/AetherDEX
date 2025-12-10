import { createFileRoute } from '@tanstack/react-router'
import { Send as SendIcon, ChevronDown } from 'lucide-react'
import { useState } from 'react'
import { useAccount, useConnect, useDisconnect, useSendTransaction } from 'wagmi'
import { parseEther } from 'viem'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

export const Route = createFileRoute('/trade/send')({
    component: SendPage,
})

function SendPage() {
    const [amount, setAmount] = useState('')
    const [recipient, setRecipient] = useState('')
    const { address, isConnected } = useAccount()
    const { connectors, connect } = useConnect()
    const { disconnect } = useDisconnect()
    const { sendTransaction, isPending } = useSendTransaction()

    const handleConnect = () => {
        const connector = connectors[0]
        if (connector) {
            connect({ connector })
        }
    }

    const handleSend = () => {
        if (!amount || !recipient) return

        sendTransaction({
            to: recipient as `0x${string}`,
            value: parseEther(amount),
        })
    }

    return (
        <div className="flex flex-col items-center justify-center min-h-[85vh] p-4 animate-float">
            <div className="w-full max-w-lg relative">
                {/* Glow Effect */}
                <div className="absolute inset-0 bg-primary/20 blur-[100px] rounded-full pointer-events-none" />

                <Card className="glass-card border-white/10 relative z-10">
                    <CardHeader className="flex flex-row items-center gap-3 pb-4">
                        <div className="p-2 rounded-lg bg-primary/10 text-primary">
                            <SendIcon className="h-5 w-5" />
                        </div>
                        <CardTitle>Send</CardTitle>
                    </CardHeader>

                    <CardContent className="space-y-4">
                        {/* Recipient Input */}
                        <div className="space-y-2 p-4 rounded-2xl bg-black/40 border border-white/5 hover:border-white/10 transition-colors">
                            <span className="text-sm text-muted-foreground block mb-1">Recipient</span>
                            <input
                                type="text"
                                placeholder="0x... or ENS name"
                                value={recipient}
                                onChange={(e) => setRecipient(e.target.value)}
                                className="bg-transparent text-lg text-white w-full outline-none placeholder:text-muted-foreground/30 font-medium"
                            />
                        </div>

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

                        {/* Action Button */}
                        {isConnected ? (
                            <Button
                                size="lg"
                                className="w-full text-lg font-semibold shadow-xl shadow-primary/20"
                                onClick={handleSend}
                                disabled={isPending}
                                loading={isPending}
                            >
                                {isPending ? 'Sending...' : 'Send'}
                            </Button>
                        ) : (
                            <Button
                                size="lg"
                                className="w-full text-lg font-semibold"
                                onClick={handleConnect}
                            >
                                Connect Wallet to Send
                            </Button>
                        )}
                    </CardContent>
                </Card>
            </div>
        </div>
    )
}
