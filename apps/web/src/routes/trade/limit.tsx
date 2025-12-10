import { createFileRoute, Link } from '@tanstack/react-router'
import { Settings, ChevronDown } from 'lucide-react'
import { useState } from 'react'
import { useAccount, useConnect, useDisconnect, useWriteContract } from 'wagmi'
import { ROUTER_ABI } from '../../lib/abis'
import { parseEther } from 'viem'

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
    const { disconnect } = useDisconnect()
    const { writeContract, isPending } = useWriteContract()

    const handleConnect = () => {
        const connector = connectors[0]
        if (connector) {
            connect({ connector })
        }
    }

    const handlePlaceOrder = () => {
        if (!amount || !price) return

        // Mock limit order placement (using swap as placeholder since actual limit order logic might vary)
        // In reality this would likely call a different function on the router or a specific LimitOrderManager
        console.log("Placing limit order:", amount, "@", price)
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
                        <Link to="/trade/swap" className="text-gray-400 hover:text-white transition">Swap</Link>
                        <Link to="/trade/limit" className="text-cyan-400 font-medium">Limit</Link>
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

            {/* Limit Order Interface */}
            <main className="container mx-auto px-6 py-12 flex items-center justify-center">
                <div className="w-full max-w-md">
                    <div className="glass-card p-6">
                        <div className="flex items-center justify-between mb-6">
                            <h2 className="text-xl font-semibold text-white">Limit Order</h2>
                            <button className="p-2 hover:bg-white/10 rounded-lg transition">
                                <Settings className="w-5 h-5 text-gray-400" />
                            </button>
                        </div>

                        {/* Amount */}
                        <div className="bg-slate-800/50 rounded-2xl p-4 mb-4">
                            <div className="flex items-center justify-between mb-2">
                                <span className="text-sm text-gray-400">Amount</span>
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
                                    <div className="w-6 h-6 bg-gradient-to-br from-blue-400 to-purple-500 rounded-full" />
                                    <span className="font-semibold">ETH</span>
                                    <ChevronDown className="w-4 h-4" />
                                </button>
                            </div>
                        </div>

                        {/* Limit Price */}
                        <div className="bg-slate-800/50 rounded-2xl p-4 mb-6">
                            <div className="flex items-center justify-between mb-2">
                                <span className="text-sm text-gray-400">Limit Price</span>
                            </div>
                            <div className="flex items-center gap-4">
                                <input
                                    type="text"
                                    placeholder="0.00"
                                    value={price}
                                    onChange={(e) => setPrice(e.target.value)}
                                    className="flex-1 bg-transparent text-3xl font-semibold text-white outline-none"
                                />
                                <span className="text-gray-400">USDC</span>
                            </div>
                        </div>

                        {isConnected ? (
                            <button
                                onClick={handlePlaceOrder}
                                className="w-full py-4 bg-gradient-to-r from-cyan-500 to-blue-600 rounded-2xl font-semibold text-lg hover:opacity-90 transition-all"
                            >
                                Place Limit Order
                            </button>
                        ) : (
                            <button
                                onClick={handleConnect}
                                className="w-full py-4 bg-slate-700 text-gray-300 rounded-2xl font-semibold text-lg hover:bg-slate-600 transition-all"
                            >
                                Connect Wallet
                            </button>
                        )}
                    </div>
                </div>
            </main>
        </div>
    )
}
