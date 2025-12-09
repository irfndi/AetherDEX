import { createFileRoute, Link } from '@tanstack/react-router'
import { ArrowDown, Settings, ChevronDown } from 'lucide-react'
import { useState } from 'react'
import { useAccount, useConnect, useDisconnect } from 'wagmi'

export const Route = createFileRoute('/trade/swap')({
    component: SwapPage,
})

function SwapPage() {
    const [sellAmount, setSellAmount] = useState('')
    const [buyAmount, setBuyAmount] = useState('')
    const { address, isConnected } = useAccount()
    const { connectors, connect } = useConnect()
    const { disconnect } = useDisconnect()

    const handleConnect = () => {
        const connector = connectors[0]
        if (connector) {
            connect({ connector })
        }
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
                                <button className="flex items-center gap-2 px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded-xl transition">
                                    <div className="w-6 h-6 bg-gradient-to-br from-blue-400 to-purple-500 rounded-full" />
                                    <span className="font-semibold">ETH</span>
                                    <ChevronDown className="w-4 h-4" />
                                </button>
                            </div>
                        </div>

                        {/* Swap Direction */}
                        <div className="flex justify-center -my-2 relative z-10">
                            <button className="p-3 bg-slate-700 hover:bg-slate-600 rounded-xl border-4 border-slate-900 transition">
                                <ArrowDown className="w-4 h-4" />
                            </button>
                        </div>

                        {/* Buy Panel */}
                        <div className="bg-slate-800/50 rounded-2xl p-4 mt-2">
                            <div className="flex items-center justify-between mb-2">
                                <span className="text-sm text-gray-400">Buy</span>
                            </div>
                            <div className="flex items-center gap-4">
                                <input
                                    type="text"
                                    placeholder="0"
                                    value={buyAmount}
                                    onChange={(e) => setBuyAmount(e.target.value)}
                                    className="flex-1 bg-transparent text-3xl font-semibold text-white outline-none"
                                />
                                <button className="flex items-center gap-2 px-4 py-2 bg-cyan-500/20 text-cyan-400 hover:bg-cyan-500/30 rounded-xl transition">
                                    Select token
                                    <ChevronDown className="w-4 h-4" />
                                </button>
                            </div>
                        </div>

                        {/* Swap Button */}
                        {isConnected ? (
                            <button className="w-full mt-6 py-4 bg-gradient-to-r from-cyan-500 to-blue-600 rounded-2xl font-semibold text-lg hover:opacity-90 transition-all glow-aether">
                                Swap
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
            </main>
        </div>
    )
}
