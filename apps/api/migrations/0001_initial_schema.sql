-- AetherDEX initial schema
-- Created: 2026-06-30

-- Users table — tracks wallets that have interacted with the DEX
CREATE TABLE IF NOT EXISTS users (
    address TEXT PRIMARY KEY NOT NULL,        -- Ethereum address (0x...)
    nonce TEXT NOT NULL,                      -- SIWE nonce
    first_seen_at INTEGER NOT NULL,           -- Unix timestamp
    last_active_at INTEGER NOT NULL,          -- Unix timestamp
    tx_count INTEGER NOT NULL DEFAULT 0,
    total_volume_usd REAL NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_users_last_active ON users(last_active_at DESC);

-- Tokens table — ERC20 tokens tracked by the DEX
CREATE TABLE IF NOT EXISTS tokens (
    address TEXT PRIMARY KEY NOT NULL,        -- ERC20 contract address
    symbol TEXT NOT NULL,
    name TEXT NOT NULL,
    decimals INTEGER NOT NULL,
    logo_url TEXT,
    is_verified INTEGER NOT NULL DEFAULT 0,   -- 0/1 boolean
    is_native INTEGER NOT NULL DEFAULT 0,     -- 1 if this is native ETH/wrap
    total_supply TEXT,                        -- big number as string
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tokens_symbol ON tokens(symbol);
CREATE INDEX IF NOT EXISTS idx_tokens_verified ON tokens(is_verified, symbol);

-- Pools table — Uniswap V4 pools tracked by the DEX
CREATE TABLE IF NOT EXISTS pools (
    pool_id TEXT PRIMARY KEY NOT NULL,        -- bytes32 as hex string
    token0_address TEXT NOT NULL,
    token1_address TEXT NOT NULL,
    fee INTEGER NOT NULL,                     -- fee tier (e.g. 3000 = 0.3%)
    tick_spacing INTEGER NOT NULL,
    hook_address TEXT,                        -- AetherHook address
    sqrt_price_x96 TEXT NOT NULL,             -- current sqrt price (big number as string)
    current_tick INTEGER NOT NULL,
    liquidity TEXT NOT NULL,                  -- total liquidity (big number as string)
    tvl_usd REAL NOT NULL DEFAULT 0,
    volume_24h_usd REAL NOT NULL DEFAULT 0,
    fees_24h_usd REAL NOT NULL DEFAULT 0,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY (token0_address) REFERENCES tokens(address),
    FOREIGN KEY (token1_address) REFERENCES tokens(address)
);
CREATE INDEX IF NOT EXISTS idx_pools_active ON pools(is_active, tvl_usd DESC);
CREATE INDEX IF NOT EXISTS idx_pools_tokens ON pools(token0_address, token1_address);

-- Transactions table — on-chain swaps, liquidity events
CREATE TABLE IF NOT EXISTS transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tx_hash TEXT UNIQUE NOT NULL,
    user_address TEXT NOT NULL,
    pool_id TEXT,                             -- nullable for non-pool txs
    tx_type TEXT NOT NULL,                    -- 'swap' | 'add_liquidity' | 'remove_liquidity' | 'create_pool'
    token_in TEXT,
    token_out TEXT,
    amount_in TEXT,                           -- big number as string
    amount_out TEXT,                          -- big number as string
    amount_usd REAL,
    gas_used INTEGER,
    gas_price TEXT,
    block_number INTEGER NOT NULL,
    block_timestamp INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',   -- 'pending' | 'confirmed' | 'failed'
    created_at INTEGER NOT NULL,
    FOREIGN KEY (user_address) REFERENCES users(address),
    FOREIGN KEY (pool_id) REFERENCES pools(pool_id)
);
CREATE INDEX IF NOT EXISTS idx_tx_user ON transactions(user_address, block_timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_tx_pool ON transactions(pool_id, block_timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_tx_block ON transactions(block_number DESC);
CREATE INDEX IF NOT EXISTS idx_tx_status ON transactions(status);

-- Liquidity positions — per-user LP positions
CREATE TABLE IF NOT EXISTS liquidity_positions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_address TEXT NOT NULL,
    pool_id TEXT NOT NULL,
    tick_lower INTEGER NOT NULL,
    tick_upper INTEGER NOT NULL,
    liquidity TEXT NOT NULL,                  -- LP tokens amount (big number as string)
    amount0 TEXT NOT NULL,                    -- token0 amount
    amount1 TEXT NOT NULL,                    -- token1 amount
    fees_earned_token0 TEXT NOT NULL DEFAULT '0',
    fees_earned_token1 TEXT NOT NULL DEFAULT '0',
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY (user_address) REFERENCES users(address),
    FOREIGN KEY (pool_id) REFERENCES pools(pool_id)
);
CREATE INDEX IF NOT EXISTS idx_lp_user ON liquidity_positions(user_address, is_active);
CREATE INDEX IF NOT EXISTS idx_lp_pool ON liquidity_positions(pool_id, is_active);

-- Price cache — recent prices for fast retrieval (5min TTL via updated_at)
CREATE TABLE IF NOT EXISTS price_cache (
    token_address TEXT PRIMARY KEY NOT NULL,
    price_usd REAL NOT NULL,
    updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_price_updated ON price_cache(updated_at DESC);
