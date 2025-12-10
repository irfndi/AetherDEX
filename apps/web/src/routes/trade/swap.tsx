import { createFileRoute, Link } from '@tanstack/react-router'
import { ArrowDown, Settings, ChevronDown, Loader2 } from 'lucide-react'
import { useState, useMemo, useEffect } from 'react'
import { useAccount, useConnect, useDisconnect, useWriteContract } from 'wagmi'
import { ROUTER_ABI } from '../../lib/abis'
import { parseEther } from 'viem'
import { useTokens, useSwapQuote } from '../../hooks/use-api'
import type { Token } from '../../types/api'

// Address of the Router Contract (Placeholder - will be replaced with real address)
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
    const { disconnect } = useDisconnect()
    const { writeContract, isPending } = useWriteContract()
    const { data: tokens, isLoading: isLoadingTokens } = useTokens()

    // Set default tokens when loaded
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
                parseEther(quote.min_amount_out), // Use calculated min amount with slippage
                [selectedSellToken.address as `0x${string}`, selectedBuyToken.address as `0x${string}`],
                address!,
                BigInt(Math.floor(Date.now() / 1000) + 60 * 20), // deadline: 20 minutes
            ],
        })
    }

    const handleTokenSelect = (token: Token, type: 'sell' | 'buy') => {
        if (type === 'sell') {
            // If selecting the same token as buy, swap them
            if (selectedBuyToken && token.address === selectedBuyToken.address) {
                setSelectedBuyToken(selectedSellToken)
            }
            setSelectedSellToken(token)
        } else {
            // If selecting the same token as sell, swap them
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
        <div className="min-h-screen">
            {/* Header */}
            <header className="sticky top-0 z-50 glass border-b border-white/10">
                <div className="container mx-auto px-6 py-4 flex items-center justify-between">
                    <Link to="/" className="text-2xl font-bold bg-gradient-to-r from-cyan-400 to-blue-500 bg-clip-text text-transparent">
                        AetherDEX
                    </Link>

                    <nav className="flex items-center gap-6">
                        <Link to="/trade/swap" className="text-cyan-400 font-medium">Swap</Link>
                        <Link to="/trade/limit" className="text-gray-400 hover:text-white transition">Limit</Link>
                        <Link to="/trade/send" className="text-gray-400 hover:text-white transition">Send</Link>
                    </nav>

                    {isConnected ? (
                        <button
                            onClick={() => disconnect()}
                            className="px-6 py-2.5 bg-slate-800 rounded-xl font-semibold hover:bg-slate-700 transition-all border border-slate-700"
                        >
                            {address?.slice(0, 6)}...{address?.slice(-4)}
                        </button>
                    ) : (
                        <button
                            onClick={handleConnect}
                            className="px-6 py-2.5 bg-gradient-to-r from-cyan-500 to-blue-600 rounded-xl font-semibold hover:opacity-90 transition-all"
                        >
                            Connect Wallet
                        </button>
                    )}
                </div>
            </header>


            {/* Swap Interface */}
            <main className="container mx-auto px-6 py-12 flex items-center justify-center">
                <div className="w-full max-w-md">
                    {/* Swap Card */}
                    <div className="glass-card p-6 glow-aether">
                        {/* Header */}
                        <div className="flex items-center justify-between mb-6">
                            <h2 className="text-xl font-semibold text-white">Swap</h2>
                            <button className="p-2 hover:bg-white/10 rounded-lg transition">
                                <Settings className="w-5 h-5 text-gray-400" />
                            </button>
                        </div>

                        {/* Sell Panel */}
                        <div className="bg-slate-800/50 rounded-2xl p-4 mb-2">
                            <div className="flex items-center justify-between mb-2">
                                <span className="text-sm text-gray-400">Sell</span>
                                <span className="text-sm text-gray-400">Balance: 0.0</span>
                            </div>
                            <div className="flex items-center gap-4">
                                <input
                                    type="text"
                                    placeholder="0"
                                    value={sellAmount}
                                    onChange={(e) => setSellAmount(e.target.value)}
                                    className="flex-1 bg-transparent text-3xl font-semibold text-white outline-none"
                                />
                                <button
                                    onClick={() => setIsSelectorOpen('sell')}
                                    className="flex items-center gap-2 px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded-xl transition"
                                >
                                    <div className="w-6 h-6 bg-gradient-to-br from-blue-400 to-purple-500 rounded-full" />
                                    <span className="font-semibold">{selectedSellToken?.symbol || 'Select'}</span>
                                    <ChevronDown className="w-4 h-4" />
                                </button>
                            </div>
                        </div>

                        {/* Swap Direction */}
                        <div className="flex justify-center -my-2 relative z-10">
                            <button
                                onClick={handleSwapDirection}
                                className="p-3 bg-slate-700 hover:bg-slate-600 rounded-xl border-4 border-slate-900 transition"
                            >
                                <ArrowDown className="w-4 h-4" />
                            </button>
                        </div>

                        {/* Buy Panel */}
                        <div className="bg-slate-800/50 rounded-2xl p-4 mt-2">
                            <div className="flex items-center justify-between mb-2">
                                <span className="text-sm text-gray-400">Buy</span>
                                {quote && (
                                    <span className="text-sm text-gray-400">
                                        Price Impact: {quote.price_impact}%
                                    </span>
                                )}
                            </div>
                            <div className="flex items-center gap-4">
                                <div className="flex-1 flex items-center">
                                    {isLoadingQuote ? (
                                        <Loader2 className="w-8 h-8 text-gray-400 animate-spin" />
                                    ) : (
                                        <span className="text-3xl font-semibold text-white">
                                            {quote?.amount_out || '0'}
                                        </span>
                                    )}
                                </div>
                                <button
                                    onClick={() => setIsSelectorOpen('buy')}
                                    className="flex items-center gap-2 px-4 py-2 bg-cyan-500/20 text-cyan-400 hover:bg-cyan-500/30 rounded-xl transition"
                                >
                                    {selectedBuyToken ? (
                                        <>
                                            <div className="w-6 h-6 bg-gradient-to-br from-cyan-400 to-blue-500 rounded-full" />
                                            <span className="font-semibold">{selectedBuyToken.symbol}</span>
                                        </>
                                    ) : (
                                        <span>{isLoadingTokens ? 'Loading...' : 'Select token'}</span>
                                    )}
                                    <ChevronDown className="w-4 h-4" />
                                </button>
                            </div>
                        </div>

                        {/* Quote Info */}
                        {quote && (
                            <div className="mt-4 p-3 bg-slate-800/30 rounded-xl text-sm space-y-1">
                                <div className="flex justify-between text-gray-400">
                                    <span>Fee ({(parseFloat(quote.fee_rate) * 100).toFixed(2)}%)</span>
                                    <span>{quote.fee} {selectedSellToken?.symbol}</span>
                                </div>
                                <div className="flex justify-between text-gray-400">
                                    <span>Min. received</span>
                                    <span>{quote.min_amount_out} {selectedBuyToken?.symbol}</span>
                                </div>
                            </div>
                        )}

                        {/* Error Message */}
                        {quoteError && sellAmount && parseFloat(sellAmount) > 0 && (
                            <div className="mt-4 p-3 bg-red-500/10 border border-red-500/20 rounded-xl text-sm text-red-400">
                                {(quoteError as Error).message || 'Failed to get quote'}
                            </div>
                        )}

                        {/* Swap Button */}
                        {isConnected ? (
                            <button
                                onClick={handleSwap}
                                disabled={isPending || isLoadingQuote || !quote}
                                className="w-full mt-6 py-4 bg-gradient-to-r from-cyan-500 to-blue-600 rounded-2xl font-semibold text-lg hover:opacity-90 transition-all glow-aether disabled:opacity-50"
                            >
                                {isPending ? 'Swapping...' : isLoadingQuote ? 'Getting quote...' : 'Swap'}
                            </button>
                        ) : (
                            <button
                                onClick={handleConnect}
                                className="w-full mt-6 py-4 bg-slate-700 text-gray-300 rounded-2xl font-semibold text-lg hover:bg-slate-600 transition-all"
                            >
                                Connect Wallet to Swap
                            </button>
                        )}
                    </div>
                </div>

                {/* Token Selector Modal */}
                {isSelectorOpen && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
                        <div className="glass-card w-full max-w-md p-6 m-4">
                            <div className="flex items-center justify-between mb-6">
                                <h3 className="text-xl font-semibold text-white">
                                    Select {isSelectorOpen === 'sell' ? 'sell' : 'buy'} token
                                </h3>
                                <button
                                    onClick={() => setIsSelectorOpen(null)}
                                    className="p-2 hover:bg-white/10 rounded-lg transition text-gray-400 hover:text-white"
                                >
                                    Close
                                </button>
                            </div>

                            <div className="space-y-2 max-h-96 overflow-y-auto">
                                {isLoadingTokens ? (
                                    <div className="text-center text-gray-400 py-4">Loading tokens...</div>
                                ) : (
                                    tokens?.map((token) => (
                                        <button
                                            key={token.address}
                                            onClick={() => handleTokenSelect(token, isSelectorOpen)}
                                            className="w-full flex items-center justify-between p-3 hover:bg-white/5 rounded-xl transition group"
                                        >
                                            <div className="flex items-center gap-3">
                                                <div className="w-8 h-8 bg-gradient-to-br from-blue-400 to-purple-500 rounded-full" />
                                                <div className="text-left">
                                                    <div className="text-white font-medium">{token.symbol}</div>
                                                    <div className="text-sm text-gray-400">{token.name}</div>
                                                </div>
                                            </div>
                                            <span className="text-white opacity-0 group-hover:opacity-100 transition">
                                                Select
                                            </span>
                                        </button>
                                    ))
                                )}
                            </div>
                        </div>
                    </div>
                )}
            </main>
        </div>
    )
}

