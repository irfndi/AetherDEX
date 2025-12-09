import { createFileRoute, Link } from '@tanstack/react-router'
import { ShoppingCart, ChevronDown } from 'lucide-react'
import { useState } from 'react'

export const Route = createFileRoute('/trade/buy')({
    component: BuyPage,
})

function BuyPage() {
    const [amount, setAmount] = useState('')

    return (
        <div className="min-h-screen">
            {/* Header */}
            <header className="sticky top-0 z-50 glass border-b border-white/10">
                <div className="container mx-auto px-6 py-4 flex items-center justify-between">
                    <Link to="/" className="text-2xl font-bold bg-gradient-to-r from-cyan-400 to-blue-500 bg-clip-text text-transparent">
                        AetherDEX
                    </Link>

                    <nav className="flex items-center gap-6">
                        <Link to="/trade/swap" className="text-gray-400 hover:text-white transition">Swap</Link>
                        <Link to="/trade/limit" className="text-gray-400 hover:text-white transition">Limit</Link>
                        <Link to="/trade/send" className="text-gray-400 hover:text-white transition">Send</Link>
                    </nav>

                    <button className="px-6 py-2.5 bg-gradient-to-r from-cyan-500 to-blue-600 rounded-xl font-semibold hover:opacity-90 transition-all">
                        Connect Wallet
                    </button>
                </div>
            </header>

            {/* Buy Interface */}
            <main className="container mx-auto px-6 py-12 flex items-center justify-center">
                <div className="w-full max-w-md">
                    <div className="glass-card p-6">
                        <div className="flex items-center gap-2 mb-6">
                            <ShoppingCart className="w-6 h-6 text-green-400" />
                            <h2 className="text-xl font-semibold text-white">Buy Crypto</h2>
                        </div>

                        {/* Amount */}
                        <div className="bg-slate-800/50 rounded-2xl p-4 mb-4">
                            <div className="flex items-center justify-between mb-2">
                                <span className="text-sm text-gray-400">You pay</span>
                            </div>
                            <div className="flex items-center gap-4">
                                <input
                                    type="text"
                                    placeholder="0"
                                    value={amount}
                                    onChange={(e) => setAmount(e.target.value)}
                                    className="flex-1 bg-transparent text-3xl font-semibold text-white outline-none"
                                />
                                <button className="flex items-center gap-2 px-4 py-2 bg-slate-700 rounded-xl">
                                    <span className="font-semibold">USD</span>
                                    <ChevronDown className="w-4 h-4" />
                                </button>
                            </div>
                        </div>

                        {/* You receive */}
                        <div className="bg-slate-800/50 rounded-2xl p-4 mb-6">
                            <div className="flex items-center justify-between mb-2">
                                <span className="text-sm text-gray-400">You receive</span>
                            </div>
                            <div className="flex items-center gap-4">
                                <span className="flex-1 text-3xl font-semibold text-white">~0</span>
                                <button className="flex items-center gap-2 px-4 py-2 bg-slate-700 rounded-xl">
                                    <div className="w-6 h-6 bg-gradient-to-br from-blue-400 to-purple-500 rounded-full" />
                                    <span className="font-semibold">ETH</span>
                                    <ChevronDown className="w-4 h-4" />
                                </button>
                            </div>
                        </div>

                        <button className="w-full py-4 bg-gradient-to-r from-green-500 to-emerald-600 rounded-2xl font-semibold text-lg hover:opacity-90 transition-all">
                            Continue to Payment
                        </button>
                    </div>
                </div>
            </main>
        </div>
    )
}
