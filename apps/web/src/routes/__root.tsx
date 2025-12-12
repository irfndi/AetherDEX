import { createRootRoute, Outlet } from '@tanstack/react-router'
import { TanStackRouterDevtools } from '@tanstack/router-devtools'
import { ThemeProvider } from '@/components/ui/theme-provider'
import { Header } from '@/components/features/common/Header'
import { Toaster } from '@/components/ui/toaster'
import { useState } from 'react'

export const Route = createRootRoute({
    component: RootLayout,
})

function RootLayout() {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const [_walletAddress, setWalletAddress] = useState("")

    const handleWalletConnect = (address: string) => {
        setWalletAddress(address)
    }

    return (
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
            <div className="min-h-screen">
                <Header onWalletConnect={handleWalletConnect} />

                {/* Background gradient orbs */}
                <div className="fixed inset-0 overflow-hidden pointer-events-none">
                    <div className="absolute -top-40 -right-40 w-80 h-80 bg-cyan-500/20 rounded-full blur-3xl animate-pulse" />
                    <div className="absolute -bottom-40 -left-40 w-80 h-80 bg-blue-500/20 rounded-full blur-3xl animate-pulse" style={{ animationDelay: '1s' }} />
                </div>

                <div className="pt-16">
                    <Outlet />
                </div>

                <Toaster />
                {import.meta.env.DEV && <TanStackRouterDevtools position="bottom-right" />}
            </div>
        </ThemeProvider>
    )
}
