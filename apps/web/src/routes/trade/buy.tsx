import { createFileRoute } from '@tanstack/react-router'
import { ShoppingCart, ChevronDown } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

export const Route = createFileRoute('/trade/buy')({
    component: BuyPage,
})

function BuyPage() {
    const [amount, setAmount] = useState('')

    return (
        <div className="flex flex-col items-center justify-center min-h-[85vh] p-4 animate-float">
            <div className="w-full max-w-lg relative">
                {/* Glow Effect */}
                <div className="absolute inset-0 bg-primary/20 blur-[100px] rounded-full pointer-events-none" />

                <Card className="glass-card border-white/10 relative z-10">
                    <CardHeader className="flex flex-row items-center gap-3 pb-4">
                        <div className="p-2 rounded-lg bg-green-500/10 text-green-400">
                            <ShoppingCart className="h-5 w-5" />
                        </div>
                        <CardTitle>Buy Crypto</CardTitle>
                    </CardHeader>

                    <CardContent className="space-y-4">
                        {/* Pay Section */}
                        <div className="space-y-2 p-4 rounded-2xl bg-black/40 border border-white/5 hover:border-white/10 transition-colors">
                            <div className="flex justify-between text-sm text-muted-foreground">
                                <span>You pay</span>
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
                                    className="rounded-xl gap-2 font-semibold min-w-[100px]"
                                >
                                    USD
                                    <ChevronDown className="h-4 w-4 opacity-50" />
                                </Button>
                            </div>
                        </div>

                        {/* Receive Section */}
                        <div className="space-y-2 p-4 rounded-2xl bg-black/40 border border-white/5 hover:border-white/10 transition-colors">
                            <div className="flex justify-between text-sm text-muted-foreground">
                                <span>You receive</span>
                            </div>
                            <div className="flex gap-4">
                                <span className="flex-1 text-3xl font-medium text-white">~0</span>
                                <Button
                                    variant="secondary"
                                    className="rounded-xl gap-2 font-semibold min-w-[100px]"
                                >
                                    ETH
                                    <ChevronDown className="h-4 w-4 opacity-50" />
                                </Button>
                            </div>
                        </div>

                        {/* Action Button */}
                        <Button
                            size="lg"
                            className="w-full text-lg font-semibold bg-gradient-to-r from-green-500 to-emerald-600 hover:from-green-600 hover:to-emerald-700 shadow-lg shadow-green-500/20 text-white border-0"
                        >
                            Continue to Payment
                        </Button>
                    </CardContent>
                </Card>
            </div>
        </div>
    )
}
