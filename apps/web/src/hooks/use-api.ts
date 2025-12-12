import { useQuery } from '@tanstack/react-query'
import { fetchPools, fetchTokens, fetchSwapQuote, type SwapQuoteParams } from '../lib/api'
import type { Pool, Token, SwapQuote } from '../types/api'

export const usePools = () => {
    return useQuery<Pool[]>({
        queryKey: ['pools'],
        queryFn: fetchPools,
    })
}

export const useTokens = () => {
    return useQuery<Token[]>({
        queryKey: ['tokens'],
        queryFn: fetchTokens,
    })
}

export const useSwapQuote = (params: SwapQuoteParams | null) => {
    return useQuery<SwapQuote>({
        queryKey: ['swapQuote', params?.tokenIn, params?.tokenOut, params?.amountIn],
        queryFn: () => fetchSwapQuote(params!),
        enabled: Boolean(
            params?.tokenIn &&
            params?.tokenOut &&
            params?.amountIn &&
            parseFloat(params.amountIn) > 0
        ),
        staleTime: 10000, // 10 seconds - quotes update frequently
        retry: false, // Don't retry on failure (e.g., pool not found)
    })
}

