import { createFileRoute, Link } from '@tanstack/react-router'
import { ArrowRight, Zap, Shield, BarChart3 } from 'lucide-react'

export const Route = createFileRoute('/')({
    component: HomePage,
})

function HomePage() {
    return (
        <div className="relative min-h-screen">
            {/* Header */}
            <header className="sticky top-0 z-50 glass border-b border-white/10">
                <div className="container mx-auto px-6 py-4 flex items-center justify-between">
                    <Link to="/" className="text-2xl font-bold text-glow bg-gradient-to-r from-cyan-400 to-blue-500 bg-clip-text text-transparent">
                        AetherDEX
                    </Link>

                    <nav className="hidden md:flex items-center gap-8">
                        <Link to="/trade/swap" className="text-gray-300 hover:text-white transition-colors">
                            Swap
                        </Link>
                        <Link to="/trade/limit" className="text-gray-300 hover:text-white transition-colors">
                            Limit
                        </Link>
                        <Link to="/trade/send" className="text-gray-300 hover:text-white transition-colors">
                            Send
                        </Link>
                    </nav>

                    <button className="px-6 py-2.5 bg-gradient-to-r from-cyan-500 to-blue-600 rounded-xl font-semibold hover:opacity-90 transition-all glow-aether">
                        Connect Wallet
                    </button>
                </div>
            </header>

            {/* Hero Section */}
            <section className="container mx-auto px-6 py-20 text-center">
                <div className="max-w-4xl mx-auto">
                    <h1 className="text-5xl md:text-7xl font-bold mb-6 leading-tight">
                        <span className="bg-gradient-to-r from-cyan-400 via-blue-400 to-purple-400 bg-clip-text text-transparent">
                            Trade Tokens
                        </span>
                        <br />
                        <span className="text-white">Instantly</span>
                    </h1>

                    <p className="text-xl text-gray-400 mb-10 max-w-2xl mx-auto">
                        Experience the next generation of decentralized trading with lightning-fast swaps,
                        minimal fees, and maximum security.
                    </p>

                    <div className="flex flex-wrap justify-center gap-4">
                        <Link
                            to="/trade/swap"
                            className="px-8 py-4 bg-gradient-to-r from-cyan-500 to-blue-600 rounded-2xl font-semibold text-lg hover:scale-105 transition-transform glow-aether flex items-center gap-2"
                        >
                            Start Trading <ArrowRight className="w-5 h-5" />
                        </Link>
                        <button className="px-8 py-4 glass-card hover:bg-white/10 transition-colors rounded-2xl font-semibold text-lg">
                            Learn More
                        </button>
                    </div>
                </div>
            </section>

            {/* Features */}
            <section className="container mx-auto px-6 py-20">
                <div className="grid md:grid-cols-3 gap-8">
                    <FeatureCard
                        icon={<Zap className="w-8 h-8 text-cyan-400" />}
                        title="Lightning Fast"
                        description="Execute trades in milliseconds with our optimized routing engine."
                    />
                    <FeatureCard
                        icon={<Shield className="w-8 h-8 text-green-400" />}
                        title="Fully Secure"
                        description="Non-custodial trading with audited smart contracts."
                    />
                    <FeatureCard
                        icon={<BarChart3 className="w-8 h-8 text-purple-400" />}
                        title="Best Rates"
                        description="Aggregated liquidity for optimal pricing on every swap."
                    />
                </div>
            </section>
        </div>
    )
}

function FeatureCard({ icon, title, description }: { icon: React.ReactNode; title: string; description: string }) {
    return (
        <div className="glass-card p-8 hover:scale-105 transition-transform cursor-pointer">
            <div className="mb-4">{icon}</div>
            <h3 className="text-xl font-semibold text-white mb-2">{title}</h3>
            <p className="text-gray-400">{description}</p>
        </div>
    )
}
