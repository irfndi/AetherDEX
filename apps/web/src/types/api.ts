export interface Pool {
    id: number
    pool_id: string
    token0: string
    token1: string
    fee_rate: string
    liquidity: string
    reserve0: string
    reserve1: string
    volume_24h: string
    tvl: string
    is_active: boolean
    created_at: string
    updated_at: string
}

export interface Token {
    id: number
    address: string
    symbol: string
    name: string
    decimals: number
    total_supply: string
    price: string
    market_cap: string
    volume_24h: string
    is_verified: boolean
    is_active: boolean
    logo_url?: string
    website_url?: string
    created_at: string
    updated_at: string
}

export interface Transaction {
    id: number
    tx_hash: string
    user_address: string
    pool_id: string
    type: 'swap' | 'add_liquidity' | 'remove_liquidity' | 'create_pool'
    status: 'pending' | 'confirmed' | 'failed'
    token_in: string
    token_out: string
    amount_in: string
    amount_out: string
    gas_used: number
    gas_price: string
    block_number: number
    block_hash: string
    created_at: string
    updated_at: string
}
