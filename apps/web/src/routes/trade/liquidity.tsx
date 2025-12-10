import { createFileRoute } from '@tanstack/react-router'
import { Plus, Minus, Droplets, ChevronDown, Loader2 } from 'lucide-react'
import { useState, useEffect } from 'react'
import { useAccount, useConnect } from 'wagmi'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { usePools, useTokens } from '../../hooks/use-api'
import type { Token, Pool } from '../../types/api'
import { cn } from '@/lib/utils'

export const Route = createFileRoute('/trade/liquidity')({
    component: LiquidityPage,
})

type Tab = 'add' | 'remove' | 'positions'

function LiquidityPage() {
    const [activeTab, setActiveTab] = useState<Tab>('add')
    const [tokenAAmount, setTokenAAmount] = useState('')
    const [tokenBAmount, setTokenBAmount] = useState('')
    const [selectedTokenA, setSelectedTokenA] = useState<Token | null>(null)
    const [selectedTokenB, setSelectedTokenB] = useState<Token | null>(null)
    const [removePercentage, setRemovePercentage] = useState(50)

    const { isConnected } = useAccount()
    const { connectors, connect } = useConnect()
    const { data: tokens } = useTokens()
    const { data: pools, isLoading: isLoadingPools } = usePools()

    // Set default tokens
    useEffect(() => {
        if (tokens && tokens.length >= 2 && !selectedTokenA) {
            setSelectedTokenA(tokens[0])
            setSelectedTokenB(tokens[1])
        }
    }, [tokens, selectedTokenA])

    const handleConnect = () => {
        const connector = connectors[0]
        if (connector) {
            connect({ connector })
        }
    }

    const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
        { id: 'add', label: 'Add', icon: <Plus className="h-4 w-4" /> },
        { id: 'remove', label: 'Remove', icon: <Minus className="h-4 w-4" /> },
        { id: 'positions', label: 'Positions', icon: <Droplets className="h-4 w-4" /> },
    ]

    return (
        <div className="flex flex-col items-center justify-center min-h-[85vh] p-4 animate-float">
            <div className="w-full max-w-lg relative">
                {/* Glow Effect */}
                <div className="absolute inset-0 bg-primary/20 blur-[100px] rounded-full pointer-events-none" />

                <Card className="glass-card border-white/10 relative z-10">
                    <CardHeader className="pb-4">
                        <div className="flex items-center gap-3">
                            <div className="p-2 rounded-lg bg-primary/10 text-primary">
                                <Droplets className="h-5 w-5" />
                            </div>
                            <CardTitle>Liquidity</CardTitle>
                        </div>

                        {/* Tabs */}
                        <div className="flex gap-1 p-1 mt-4 bg-black/40 rounded-xl border border-white/5">
                            {tabs.map((tab) => (
                                <button
                                    key={tab.id}
                                    onClick={() => setActiveTab(tab.id)}
                                    className={cn(
                                        "flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-medium transition-all",
                                        activeTab === tab.id
                                            ? "bg-white/10 text-white shadow-sm"
                                            : "text-muted-foreground hover:text-white hover:bg-white/5"
                                    )}
                                >
                                    {tab.icon}
                                    {tab.label}
                                </button>
                            ))}
                        </div>
                    </CardHeader>

                    <CardContent className="space-y-4">
                        {activeTab === 'add' && (
                            <>
                                {/* Token A Input */}
                                <div className="space-y-2 p-4 rounded-2xl bg-black/40 border border-white/5 hover:border-white/10 transition-colors">
                                    <div className="flex justify-between text-sm text-muted-foreground">
                                        <span>Token A</span>
                                        <span>Balance: 0.0</span>
                                    </div>
                                    <div className="flex gap-4">
                                        <input
                                            type="text"
                                            value={tokenAAmount}
                                            onChange={(e) => setTokenAAmount(e.target.value)}
                                            placeholder="0"
                                            className="bg-transparent text-3xl font-medium outline-none w-full placeholder:text-muted-foreground/30"
                                        />
                                        <Button variant="secondary" className="rounded-xl gap-2 font-semibold min-w-[120px]">
                                            {selectedTokenA?.symbol || 'Select'}
                                            <ChevronDown className="h-4 w-4 opacity-50" />
                                        </Button>
                                    </div>
                                </div>

                                {/* Plus Icon */}
                                <div className="flex justify-center">
                                    <div className="p-2 rounded-lg bg-white/5 border border-white/10">
                                        <Plus className="h-4 w-4 text-muted-foreground" />
                                    </div>
                                </div>

                                {/* Token B Input */}
                                <div className="space-y-2 p-4 rounded-2xl bg-black/40 border border-white/5 hover:border-white/10 transition-colors">
                                    <div className="flex justify-between text-sm text-muted-foreground">
                                        <span>Token B</span>
                                        <span>Balance: 0.0</span>
                                    </div>
                                    <div className="flex gap-4">
                                        <input
                                            type="text"
                                            value={tokenBAmount}
                                            onChange={(e) => setTokenBAmount(e.target.value)}
                                            placeholder="0"
                                            className="bg-transparent text-3xl font-medium outline-none w-full placeholder:text-muted-foreground/30"
                                        />
                                        <Button variant="secondary" className="rounded-xl gap-2 font-semibold min-w-[120px]">
                                            {selectedTokenB?.symbol || 'Select'}
                                            <ChevronDown className="h-4 w-4 opacity-50" />
                                        </Button>
                                    </div>
                                </div>

                                {/* Pool Info */}
                                <div className="p-3 text-sm rounded-xl bg-white/5 border border-white/5 space-y-1">
                                    <div className="flex justify-between text-muted-foreground">
                                        <span>Pool Share</span>
                                        <span className="text-foreground">~0.01%</span>
                                    </div>
                                    <div className="flex justify-between text-muted-foreground">
                                        <span>LP Tokens</span>
                                        <span className="text-foreground">0.0</span>
                                    </div>
                                </div>

                                {/* Action Button */}
                                {isConnected ? (
                                    <Button size="lg" className="w-full text-lg font-semibold shadow-xl shadow-primary/20">
                                        Add Liquidity
                                    </Button>
                                ) : (
                                    <Button size="lg" className="w-full text-lg font-semibold" onClick={handleConnect}>
                                        Connect Wallet to Add Liquidity
                                    </Button>
                                )}
                            </>
                        )}

                        {activeTab === 'remove' && (
                            <>
                                {/* Percentage Slider */}
                                <div className="space-y-4 p-4 rounded-2xl bg-black/40 border border-white/5">
                                    <div className="flex justify-between text-sm">
                                        <span className="text-muted-foreground">Remove Amount</span>
                                        <span className="text-3xl font-bold text-foreground">{removePercentage}%</span>
                                    </div>
                                    <input
                                        type="range"
                                        min="0"
                                        max="100"
                                        value={removePercentage}
                                        onChange={(e) => setRemovePercentage(Number(e.target.value))}
                                        className="w-full h-2 bg-white/10 rounded-lg appearance-none cursor-pointer accent-primary"
                                    />
                                    <div className="flex gap-2">
                                        {[25, 50, 75, 100].map((pct) => (
                                            <Button
                                                key={pct}
                                                variant="outline"
                                                size="sm"
                                                className={cn("flex-1", removePercentage === pct && "bg-primary/20 border-primary/50")}
                                                onClick={() => setRemovePercentage(pct)}
                                            >
                                                {pct}%
                                            </Button>
                                        ))}
                                    </div>
                                </div>

                                {/* Output Preview */}
                                <div className="p-4 rounded-2xl bg-black/40 border border-white/5 space-y-3">
                                    <span className="text-sm text-muted-foreground">You will receive</span>
                                    <div className="flex justify-between items-center">
                                        <span className="text-2xl font-semibold">0.0</span>
                                        <span className="text-muted-foreground">{selectedTokenA?.symbol || 'ETH'}</span>
                                    </div>
                                    <div className="flex justify-between items-center">
                                        <span className="text-2xl font-semibold">0.0</span>
                                        <span className="text-muted-foreground">{selectedTokenB?.symbol || 'USDC'}</span>
                                    </div>
                                </div>

                                {/* Action Button */}
                                {isConnected ? (
                                    <Button size="lg" variant="destructive" className="w-full text-lg font-semibold">
                                        Remove Liquidity
                                    </Button>
                                ) : (
                                    <Button size="lg" className="w-full text-lg font-semibold" onClick={handleConnect}>
                                        Connect Wallet to Remove Liquidity
                                    </Button>
                                )}
                            </>
                        )}

                        {activeTab === 'positions' && (
                            <div className="py-8 text-center">
                                {isLoadingPools ? (
                                    <div className="flex justify-center">
                                        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                                    </div>
                                ) : pools && pools.length > 0 ? (
                                    <div className="space-y-3">
                                        {pools.map((pool) => (
                                            <div
                                                key={pool.id}
                                                className="p-4 rounded-xl bg-white/5 border border-white/10 hover:border-white/20 transition-colors cursor-pointer"
                                            >
                                                <div className="flex items-center justify-between">
                                                    <div className="flex items-center gap-2">
                                                        <div className="flex -space-x-2">
                                                            <div className="h-8 w-8 rounded-full bg-gradient-to-br from-primary/80 to-purple-600/80 flex items-center justify-center text-xs font-bold border-2 border-background">
                                                                {pool.token0_symbol?.[0] || 'A'}
                                                            </div>
                                                            <div className="h-8 w-8 rounded-full bg-gradient-to-br from-green-400/80 to-emerald-600/80 flex items-center justify-center text-xs font-bold border-2 border-background">
                                                                {pool.token1_symbol?.[0] || 'B'}
                                                            </div>
                                                        </div>
                                                        <span className="font-semibold">
                                                            {pool.token0_symbol}/{pool.token1_symbol}
                                                        </span>
                                                    </div>
                                                    <div className="text-right">
                                                        <div className="text-sm text-muted-foreground">Your Share</div>
                                                        <div className="font-semibold">0.0%</div>
                                                    </div>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                ) : (
                                    <div className="space-y-4">
                                        <Droplets className="h-12 w-12 mx-auto text-muted-foreground/50" />
                                        <div>
                                            <p className="text-muted-foreground">No liquidity positions found</p>
                                            <p className="text-sm text-muted-foreground/70 mt-1">
                                                Add liquidity to start earning fees
                                            </p>
                                        </div>
                                        <Button variant="outline" onClick={() => setActiveTab('add')}>
                                            <Plus className="h-4 w-4 mr-2" />
                                            Add Liquidity
                                        </Button>
                                    </div>
                                )}
                            </div>
                        )}
                    </CardContent>
                </Card>
            </div>
        </div>
    )
}
