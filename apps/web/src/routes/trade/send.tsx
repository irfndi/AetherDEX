import { createFileRoute, Link } from '@tanstack/react-router'
import { Send as SendIcon, ChevronDown } from 'lucide-react'
import { useState } from 'react'
import { useAccount, useConnect, useDisconnect, useSendTransaction } from 'wagmi'
import { parseEther } from 'viem'

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
                        <Link to="/trade/send" className="text-cyan-400 font-medium">Send</Link>
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

            {/* Send Interface */}
            <main className="container mx-auto px-6 py-12 flex items-center justify-center">
                <div className="w-full max-w-md">
                    <div className="glass-card p-6">
                        <div className="flex items-center gap-2 mb-6">
                            <SendIcon className="w-6 h-6 text-cyan-400" />
                            <h2 className="text-xl font-semibold text-white">Send</h2>
                        </div>

                        {/* Recipient */}
                        <div className="bg-slate-800/50 rounded-2xl p-4 mb-4">
                            <span className="text-sm text-gray-400 mb-2 block">Recipient</span>
                            <input
                                type="text"
                                placeholder="0x... or ENS name"
                                value={recipient}
                                onChange={(e) => setRecipient(e.target.value)}
                                className="w-full bg-transparent text-lg text-white outline-none"
                            />
                        </div>

                        {/* Amount */}
                        <div className="bg-slate-800/50 rounded-2xl p-4 mb-6">
                            <div className="flex items-center justify-between mb-2">
                                <span className="text-sm text-gray-400">Amount</span>
                                <span className="text-sm text-gray-400">Balance: 0.0</span>
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

                        {isConnected ? (
                            <button
                                onClick={handleSend}
                                disabled={isPending}
                                className="w-full py-4 bg-gradient-to-r from-cyan-500 to-blue-600 rounded-2xl font-semibold text-lg hover:opacity-90 transition-all disabled:opacity-50"
                            >
                                {isPending ? 'Sending...' : 'Send'}
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
