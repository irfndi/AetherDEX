import { renderHook, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { usePools, useTokens, useSwapQuote } from '../../src/hooks/use-api'
import * as apiMethods from '../../src/lib/api'

// Unmock the hook file itself so we test the real implementation
vi.unmock('../../src/hooks/use-api')

// Mock the API library
vi.mock('../../src/lib/api', () => ({
    fetchPools: vi.fn(),
    fetchTokens: vi.fn(),
    fetchSwapQuote: vi.fn(),
}))

const createWrapper = () => {
    const queryClient = new QueryClient({
        defaultOptions: {
            queries: {
                retry: false,
            },
        },
    })
    return ({ children }: { children: React.ReactNode }) => (
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    )
}

describe('use-api Hooks', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('usePools fetches pools', async () => {
        const mockPools = [{ id: '1', pair: 'ETH/USDC' }]
        vi.mocked(apiMethods.fetchPools).mockResolvedValue(mockPools as any)

        const { result } = renderHook(() => usePools(), { wrapper: createWrapper() })

        await waitFor(() => expect(result.current.isSuccess).toBe(true))
        expect(result.current.data).toEqual(mockPools)
    })

    it('useTokens fetches tokens', async () => {
        const mockTokens = [{ symbol: 'ETH' }]
        vi.mocked(apiMethods.fetchTokens).mockResolvedValue(mockTokens as any)

        const { result } = renderHook(() => useTokens(), { wrapper: createWrapper() })

        await waitFor(() => expect(result.current.isSuccess).toBe(true))
        expect(result.current.data).toEqual(mockTokens)
    })

    it('useSwapQuote fetches quote when params are valid', async () => {
        const mockQuote = { amount_out: '100' }
        vi.mocked(apiMethods.fetchSwapQuote).mockResolvedValue(mockQuote as any)

        const params = { tokenIn: 'ETH', tokenOut: 'USDC', amountIn: '1' }
        const { result } = renderHook(() => useSwapQuote(params), { wrapper: createWrapper() })

        await waitFor(() => expect(result.current.isSuccess).toBe(true))
        expect(result.current.data).toEqual(mockQuote)
    })

    it('useSwapQuote does not fetch when params are missing', async () => {
        const { result } = renderHook(() => useSwapQuote(null), { wrapper: createWrapper() })

        expect(result.current.isFetching).toBe(false)
        expect(apiMethods.fetchSwapQuote).not.toHaveBeenCalled()
    })
})
