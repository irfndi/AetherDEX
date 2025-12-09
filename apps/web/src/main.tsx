import React from 'react'
import ReactDOM from 'react-dom/client'
import { RouterProvider, createRouter } from '@tanstack/react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { WagmiProvider } from 'wagmi'
import { config } from './wagmi'
import { routeTree } from './routeTree.gen'
import './index.css'

// Create query client
const queryClient = new QueryClient({
    defaultOptions: {
        queries: {
            staleTime: 1000 * 60, // 1 minute
            refetchOnWindowFocus: false,
        },
    },
})

// Create router
const router = createRouter({ routeTree })

// Register router for type safety
declare module '@tanstack/react-router' {
    interface Register {
        router: typeof router
    }
}

// Render app
const rootElement = document.getElementById('root')!
if (!rootElement.innerHTML) {
    const root = ReactDOM.createRoot(rootElement)
    root.render(
        <React.StrictMode>
            <WagmiProvider config={config}>
                <QueryClientProvider client={queryClient}>
                    <RouterProvider router={router} />
                </QueryClientProvider>
            </WagmiProvider>
        </React.StrictMode>
    )
}
