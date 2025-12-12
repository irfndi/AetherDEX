import axios from 'axios'

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8080/api/v1'

export const api = axios.create({
    baseURL: API_URL,
    headers: {
        'Content-Type': 'application/json',
    },
})

export const fetchPools = async () => {
    const { data } = await api.get('/pools')
    return data
}

export const fetchTokens = async () => {
    // Fallback to mock data if endpoint is not ready or returns 404
    try {
        const { data } = await api.get('/tokens')
        return data
    } catch (error) {
        console.warn('Failed to fetch tokens, using mock data', error)
        return [
            {
                id: 1,
                address: '0x0000000000000000000000000000000000000000',
                symbol: 'ETH',
                name: 'Ethereum',
                decimals: 18,
                price: '2000.0',
            },
            {
                id: 2,
                address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
                symbol: 'USDC',
                name: 'USD Coin',
                decimals: 6,
                price: '1.0',
            },
            {
                id: 3,
                address: '0x6B175474E89094C44Da98b954EedeAC495271d0F',
                symbol: 'DAI',
                name: 'Dai',
                decimals: 18,
                price: '1.0',
            },
        ]
    }
}

export interface SwapQuoteParams {
    tokenIn: string
    tokenOut: string
    amountIn: string
    slippage?: number
}

export const fetchSwapQuote = async (params: SwapQuoteParams) => {
    const { data } = await api.post('/swap/quote', {
        token_in: params.tokenIn,
        token_out: params.tokenOut,
        amount_in: params.amountIn,
        slippage: params.slippage,
    })
    return data
}

