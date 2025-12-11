import { createFileRoute } from '@tanstack/react-router'
import { ArrowDown, Settings, ChevronDown, Loader2 } from 'lucide-react'
import { useState, useMemo, useEffect } from 'react'
import { useAccount, useConnect, useDisconnect, useWriteContract } from 'wagmi'
import { ROUTER_ABI } from '../../lib/abis'
import { parseEther } from 'viem'
import { useTokens, useSwapQuote } from '../../hooks/use-api'
import type { Token } from '../../types/api'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

// Address of the Router Contract (Placeholder)
const ROUTER_ADDRESS = '0x0000000000000000000000000000000000000000'

export const Route = createFileRoute('/trade/swap')({
    component: SwapPage,
})

function SwapPage() {
    const [sellAmount, setSellAmount] = useState('')
    const [selectedSellToken, setSelectedSellToken] = useState<Token | null>(null)
    const [selectedBuyToken, setSelectedBuyToken] = useState<Token | null>(null)
    const [isSelectorOpen, setIsSelectorOpen] = useState<'sell' | 'buy' | null>(null)
    const { address, isConnected } = useAccount()
    const { connectors, connect } = useConnect()
    useDisconnect() // Hook kept for potential future use
    const { writeContract, isPending } = useWriteContract()
    const { data: tokens, isLoading: isLoadingTokens } = useTokens()

    // Set default tokens (ETH and USDC if available)
    useEffect(() => {
        if (tokens && tokens.length > 0 && !selectedSellToken) {
            setSelectedSellToken(tokens[0])
            if (tokens.length > 1) {
                setSelectedBuyToken(tokens[1])
            }
        }
    }, [tokens, selectedSellToken])

    // Build quote params
    const quoteParams = useMemo(() => {
        if (!selectedSellToken || !selectedBuyToken || !sellAmount || parseFloat(sellAmount) <= 0) {
            return null
        }
        return {
            tokenIn: selectedSellToken.address,
            tokenOut: selectedBuyToken.address,
            amountIn: sellAmount,
        }
    }, [selectedSellToken, selectedBuyToken, sellAmount])

    // Fetch swap quote
    const { data: quote, isLoading: isLoadingQuote, error: quoteError } = useSwapQuote(quoteParams)

    const handleConnect = () => {
        const connector = connectors[0]
        if (connector) {
            connect({ connector })
        }
    }

    const handleSwap = () => {
        if (!sellAmount || !quote || !selectedSellToken || !selectedBuyToken) return

        writeContract({
            address: ROUTER_ADDRESS,
            abi: ROUTER_ABI,
            functionName: 'swapExactTokensForTokens',
            args: [
                parseEther(sellAmount),
                parseEther(quote.min_amount_out),
                [selectedSellToken.address as `0x${string}`, selectedBuyToken.address as `0x${string}`],
                address!,
                BigInt(Math.floor(Date.now() / 1000) + 60 * 20),
            ],
        })
    }

    const handleTokenSelect = (token: Token, type: 'sell' | 'buy') => {
        if (type === 'sell') {
            if (selectedBuyToken && token.address === selectedBuyToken.address) {
                setSelectedBuyToken(selectedSellToken)
            }
            setSelectedSellToken(token)
        } else {
            if (selectedSellToken && token.address === selectedSellToken.address) {
                setSelectedSellToken(selectedBuyToken)
            }
            setSelectedBuyToken(token)
        }
        setIsSelectorOpen(null)
    }

    const handleSwapDirection = () => {
        const tempToken = selectedSellToken
        setSelectedSellToken(selectedBuyToken)
        setSelectedBuyToken(tempToken)
        setSellAmount(quote?.amount_out || '')
    }

    return (
        <div className="flex flex-col items-center justify-center min-h-[85vh] p-4 animate-float">
            <div className="w-full max-w-lg relative">
                {/* Glow Effect behind card */}
                <div className="absolute inset-0 bg-primary/20 blur-[100px] rounded-full pointer-events-none" />

                <Card className="glass-card border-white/10 relative z-10">
                    <CardHeader className="flex flex-row items-center justify-between pb-4">
                        <CardTitle>Swap</CardTitle>
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground">
                            <Settings className="h-4 w-4" />
                        </Button>
                    </CardHeader>

                    <CardContent className="space-y-4">
                        {/* Sell Section */}
                        <div className="space-y-2 p-4 rounded-2xl bg-black/40 border border-white/5 hover:border-white/10 transition-colors">
                            <div className="flex justify-between text-sm text-muted-foreground">
                                <span>Sell</span>
                                <span>Balance: 0.0</span>
                            </div>
                            <div className="flex gap-4">
                                <input
                                    type="text"
                                    value={sellAmount}
                                    onChange={(e) => setSellAmount(e.target.value)}
                                    placeholder="0"
                                    className="bg-transparent text-3xl font-medium outline-none w-full placeholder:text-muted-foreground/30"
                                />
                                <Button
                                    variant="secondary"
                                    className="rounded-xl gap-2 font-semibold min-w-[120px]"
                                    onClick={() => setIsSelectorOpen('sell')}
                                >
                                    {selectedSellToken?.symbol || 'Select'}
                                    <ChevronDown className="h-4 w-4 opacity-50" />
                                </Button>
                            </div>
                        </div>

                        {/* Swap Direction Button */}
                        <div className="relative h-4">
                            <div className="absolute left-1/2 -translate-x-1/2 -top-6">
                                <Button
                                    size="icon"
                                    variant="outline"
                                    className="h-10 w-10 rounded-xl bg-background border-4 border-background hover:bg-muted"
                                    onClick={handleSwapDirection}
                                >
                                    <ArrowDown className="h-4 w-4" />
                                </Button>
                            </div>
                        </div>

                        {/* Buy Section */}
                        <div className="space-y-2 p-4 rounded-2xl bg-black/40 border border-white/5 hover:border-white/10 transition-colors">
                            <div className="flex justify-between text-sm text-muted-foreground">
                                <span>Buy</span>
                                {quote && <span>Impact: {quote.price_impact}%</span>}
                            </div>
                            <div className="flex gap-4">
                                <div className="flex-1 flex items-center h-10">
                                    {isLoadingQuote ? (
                                        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                                    ) : (
                                        <span className={cn("text-3xl font-medium", !quote && "text-muted-foreground/30")}>
                                            {quote?.amount_out || '0'}
                                        </span>
                                    )}
                                </div>
                                <Button
                                    variant="secondary"
                                    className="rounded-xl gap-2 font-semibold min-w-[120px]"
                                    onClick={() => setIsSelectorOpen('buy')}
                                >
                                    {selectedBuyToken?.symbol || 'Select'}
                                    <ChevronDown className="h-4 w-4 opacity-50" />
                                </Button>
                            </div>
                        </div>

                        {/* Quote Details */}
                        {quote && (
                            <div className="p-3 text-sm rounded-xl bg-white/5 border border-white/5 space-y-1">
                                <div className="flex justify-between text-muted-foreground">
                                    <span>Rate</span>
                                    <span className="text-foreground">1 {selectedSellToken?.symbol} ≈ {(Number(quote.amount_out) / Number(sellAmount)).toFixed(4)} {selectedBuyToken?.symbol}</span>
                                </div>
                                <div className="flex justify-between text-muted-foreground">
                                    <span>Network Fee</span>
                                    <span className="text-foreground">{quote.fee} {selectedSellToken?.symbol}</span>
                                </div>
                            </div>
                        )}

                        {/* Error State */}
                        {quoteError && sellAmount && (
                            <div className="p-3 text-sm rounded-xl bg-destructive/10 border border-destructive/20 text-destructive">
                                {(quoteError as Error).message || 'Failed to fetch quote'}
                            </div>
                        )}

                        {/* Action Button */}
                        {isConnected ? (
                            <Button
                                size="lg"
                                className="w-full text-lg font-semibold shadow-xl shadow-primary/20"
                                onClick={handleSwap}
                                disabled={isPending || isLoadingQuote || !quote || !!quoteError}
                                loading={isPending}
                            >
                                {isPending ? 'Swapping...' : 'Swap'}
                            </Button>
                        ) : (
                            <Button
                                size="lg"
                                className="w-full text-lg font-semibold"
                                onClick={handleConnect}
                            >
                                Connect Wallet for Swap
                            </Button>
                        )}
                    </CardContent>
                </Card>
            </div>

            {/* Token Selector Modal Overlay */}
            {isSelectorOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
                    <Card className="w-full max-w-md glass-card h-[500px] flex flex-col">
                        <CardHeader className="flex flex-row items-center justify-between">
                            <CardTitle className="text-xl">Select Token</CardTitle>
                            <Button variant="ghost" size="sm" onClick={() => setIsSelectorOpen(null)}>Close</Button>
                        </CardHeader>
                        <div className="p-4 border-b border-white/10">
                            <Input placeholder="Search name or paste address" className="bg-black/20" />
                        </div>
                        <div className="flex-1 overflow-y-auto p-2 space-y-1">
                            {isLoadingTokens ? (
                                <div className="flex justify-center py-8"><Loader2 className="animate-spin text-muted-foreground" /></div>
                            ) : (
                                tokens?.map((token) => (
                                    <button
                                        key={token.address}
                                        onClick={() => handleTokenSelect(token, isSelectorOpen)}
                                        className="w-full flex items-center gap-3 p-3 rounded-xl hover:bg-white/5 transition-colors text-left group"
                                    >
                                        <div className="h-10 w-10 rounded-full bg-gradient-to-br from-primary/80 to-purple-600/80 flex items-center justify-center font-bold text-white shadow-lg">
                                            {token.symbol[0]}
                                        </div>
                                        <div className="flex-1">
                                            <div className="font-semibold text-foreground flex items-center justify-between">
                                                {token.symbol}
                                                {/* Mock Balance */}
                                                <span className="text-sm font-normal text-muted-foreground">0.00</span>
                                            </div>
                                            <div className="text-sm text-muted-foreground group-hover:text-primary/80 transition-colors">{token.name}</div>
                                        </div>
                                    </button>
                                ))
                            )}
                        </div>
                    </Card>
                </div>
            )}
        </div>
    )
}
