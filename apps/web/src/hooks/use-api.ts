import { useQuery } from '@tanstack/react-query'
import { fetchPools, fetchTokens } from '../lib/api'
import type { Pool, Token } from '../types/api'

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
