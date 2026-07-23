-- Chain-scope the token cache (Phase-0 review of PR #307).
--
-- Tokens become keyed by (chain_id, address): the SAME address on two chains is
-- two different token, so address alone must not be the key (cross-chain upserts
-- from the validated token list would otherwise overwrite each other's cache rows,
-- and reads could leak another chain's tokens). SQLite cannot re-key a PRIMARY KEY
-- via ALTER, so tables are rebuilt and data carried over with chain_id = 1 (the
-- only chain indexed today).
--
-- FK enforcement may reject `DROP TABLE` while another table still references the
-- dropped one, so the tables with cross-references are ALL rebuilt in children-first
-- order (transactions / liquidity_positions → pools → tokens), dropping the
-- address-only / pool-only FOREIGN KEYs that the new composite keys no longer
-- satisfy. The guard PRAGMA below additionally disables enforcement for runners
-- that execute migrations outside a transaction (it is a no-op inside one).
PRAGMA foreign_keys = off;

-- transactions: keep users FK (users is unaffected); drop the pools FK (pools is
-- rebuilt below with the same pool_id primary key, so the reference stays valid,
-- but the drop must not be blocked during the rebuild).
CREATE TABLE IF NOT EXISTS transactions_chain_aware (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tx_hash TEXT UNIQUE NOT NULL,
    user_address TEXT NOT NULL,
    pool_id TEXT,                                     -- nullable for non-pool txs
    tx_type TEXT NOT NULL,                            -- 'swap' | 'add_liquidity' | 'remove_liquidity' | 'create_pool'
    token_in TEXT,
    token_out TEXT,
    amount_in TEXT,                                   -- big number as string
    amount_out TEXT,                                  -- big number as string
    amount_usd REAL,
    gas_used INTEGER,
    gas_price TEXT,
    block_number INTEGER NOT NULL,
    block_timestamp INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',           -- 'pending' | 'confirmed' | 'failed'
    created_at INTEGER NOT NULL,
    FOREIGN KEY (user_address) REFERENCES users(address)
);
INSERT OR IGNORE INTO transactions_chain_aware
    (id, tx_hash, user_address, pool_id, tx_type, token_in, token_out, amount_in, amount_out, amount_usd,
     gas_used, gas_price, block_number, block_timestamp, status, created_at)
  SELECT id, tx_hash, user_address, pool_id, tx_type, token_in, token_out, amount_in, amount_out, amount_usd,
         gas_used, gas_price, block_number, block_timestamp, status, created_at
  FROM transactions;
DROP TABLE transactions;
ALTER TABLE transactions_chain_aware RENAME TO transactions;
CREATE INDEX IF NOT EXISTS idx_tx_user ON transactions(user_address, block_timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_tx_pool ON transactions(pool_id, block_timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_tx_block ON transactions(block_number DESC);
CREATE INDEX IF NOT EXISTS idx_tx_status ON transactions(status);

-- liquidity_positions: keep users FK; drop the pools FK for the same reason.
CREATE TABLE IF NOT EXISTS liquidity_positions_chain_aware (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_address TEXT NOT NULL,
    pool_id TEXT NOT NULL,
    tick_lower INTEGER NOT NULL,
    tick_upper INTEGER NOT NULL,
    liquidity TEXT NOT NULL,                          -- LP tokens amount (big number as string)
    amount0 TEXT NOT NULL,                            -- token0 amount
    amount1 TEXT NOT NULL,                            -- token1 amount
    fees_earned_token0 TEXT NOT NULL DEFAULT '0',
    fees_earned_token1 TEXT NOT NULL DEFAULT '0',
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY (user_address) REFERENCES users(address)
);
INSERT OR IGNORE INTO liquidity_positions_chain_aware
    (id, user_address, pool_id, tick_lower, tick_upper, liquidity, amount0, amount1,
     fees_earned_token0, fees_earned_token1, is_active, created_at, updated_at)
  SELECT id, user_address, pool_id, tick_lower, tick_upper, liquidity, amount0, amount1,
         fees_earned_token0, fees_earned_token1, is_active, created_at, updated_at
  FROM liquidity_positions;
DROP TABLE liquidity_positions;
ALTER TABLE liquidity_positions_chain_aware RENAME TO liquidity_positions;
CREATE INDEX IF NOT EXISTS idx_lp_user ON liquidity_positions(user_address, is_active);
CREATE INDEX IF NOT EXISTS idx_lp_pool ON liquidity_positions(pool_id, is_active);

-- pools: drop the address-only FOREIGN KEYs into tokens(address) — with the composite
-- (chain_id, address) primary key below they are no longer satisfiable, and pool
-- tokens are not guaranteed to appear in the default token list at all. pool_id stays
-- the primary key, keeping the transactions / liquidity_positions references valid.
-- NOTE: pools itself becomes chain-qualified when the Phase-3 indexer ingests a
-- second chain (AGENTS.md "chain-qualified keys before a second chain is indexed").
CREATE TABLE IF NOT EXISTS pools_chain_aware (
    pool_id TEXT PRIMARY KEY NOT NULL,                -- bytes32 as hex string
    token0_address TEXT NOT NULL,
    token1_address TEXT NOT NULL,
    fee INTEGER NOT NULL,                             -- fee tier (e.g. 3000 = 0.3%)
    tick_spacing INTEGER NOT NULL,
    hook_address TEXT,                                -- AetherHook address
    sqrt_price_x96 TEXT NOT NULL,                     -- current sqrt price (big number as string)
    current_tick INTEGER NOT NULL,
    liquidity TEXT NOT NULL,                          -- total liquidity (big number as string)
    tvl_usd REAL NOT NULL DEFAULT 0,
    volume_24h_usd REAL NOT NULL DEFAULT 0,
    fees_24h_usd REAL NOT NULL DEFAULT 0,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);
INSERT OR IGNORE INTO pools_chain_aware
    (pool_id, token0_address, token1_address, fee, tick_spacing, hook_address, sqrt_price_x96, current_tick,
     liquidity, tvl_usd, volume_24h_usd, fees_24h_usd, is_active, created_at, updated_at)
  SELECT pool_id, token0_address, token1_address, fee, tick_spacing, hook_address, sqrt_price_x96, current_tick,
         liquidity, tvl_usd, volume_24h_usd, fees_24h_usd, is_active, created_at, updated_at
  FROM pools;
DROP TABLE pools;
ALTER TABLE pools_chain_aware RENAME TO pools;
CREATE INDEX IF NOT EXISTS idx_pools_active ON pools(is_active, tvl_usd DESC);
CREATE INDEX IF NOT EXISTS idx_pools_tokens ON pools(token0_address, token1_address);

-- tokens: composite (chain_id, address) primary key.
CREATE TABLE IF NOT EXISTS tokens_chain_scoped (
    chain_id INTEGER NOT NULL,
    address TEXT NOT NULL,
    symbol TEXT NOT NULL,
    name TEXT NOT NULL,
    decimals INTEGER NOT NULL,
    logo_url TEXT,
    is_verified INTEGER NOT NULL DEFAULT 0,           -- 0/1 boolean
    is_native INTEGER NOT NULL DEFAULT 0,             -- 1 if this is native ETH/wrap
    total_supply TEXT,                                -- big number as string
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (chain_id, address)
);
INSERT OR IGNORE INTO tokens_chain_scoped
    (chain_id, address, symbol, name, decimals, logo_url, is_verified, is_native, total_supply, created_at, updated_at)
  SELECT 1, address, symbol, name, decimals, logo_url, is_verified, is_native, total_supply, created_at, updated_at
  FROM tokens;
DROP TABLE tokens;
ALTER TABLE tokens_chain_scoped RENAME TO tokens;
CREATE INDEX IF NOT EXISTS idx_tokens_symbol ON tokens(symbol);
CREATE INDEX IF NOT EXISTS idx_tokens_verified ON tokens(chain_id, is_verified, symbol);

-- Pass 2: restore the pool_id FOREIGN KEYs on transactions / liquidity_positions.
-- They were only dropped so the pools table could be swapped above; pools now exists
-- again with pool_id as its primary key, so the references can be reinstated (every
-- surviving pool_id satisfies them by construction — the foreign_key_check below
-- proves it). Only the pools → tokens(address) FK is permanently gone, by design:
-- tokens is now keyed by (chain_id, address), and pool tokens are not guaranteed to
-- appear in the default token list.
CREATE TABLE IF NOT EXISTS transactions_final (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tx_hash TEXT UNIQUE NOT NULL,
    user_address TEXT NOT NULL,
    pool_id TEXT,                                     -- nullable for non-pool txs
    tx_type TEXT NOT NULL,                            -- 'swap' | 'add_liquidity' | 'remove_liquidity' | 'create_pool'
    token_in TEXT,
    token_out TEXT,
    amount_in TEXT,                                   -- big number as string
    amount_out TEXT,                                  -- big number as string
    amount_usd REAL,
    gas_used INTEGER,
    gas_price TEXT,
    block_number INTEGER NOT NULL,
    block_timestamp INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',           -- 'pending' | 'confirmed' | 'failed'
    created_at INTEGER NOT NULL,
    FOREIGN KEY (user_address) REFERENCES users(address),
    FOREIGN KEY (pool_id) REFERENCES pools(pool_id)
);
INSERT OR IGNORE INTO transactions_final
    (id, tx_hash, user_address, pool_id, tx_type, token_in, token_out, amount_in, amount_out, amount_usd,
     gas_used, gas_price, block_number, block_timestamp, status, created_at)
  SELECT id, tx_hash, user_address, pool_id, tx_type, token_in, token_out, amount_in, amount_out, amount_usd,
         gas_used, gas_price, block_number, block_timestamp, status, created_at
  FROM transactions;
DROP TABLE transactions;
ALTER TABLE transactions_final RENAME TO transactions;
CREATE INDEX IF NOT EXISTS idx_tx_user ON transactions(user_address, block_timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_tx_pool ON transactions(pool_id, block_timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_tx_block ON transactions(block_number DESC);
CREATE INDEX IF NOT EXISTS idx_tx_status ON transactions(status);

CREATE TABLE IF NOT EXISTS liquidity_positions_final (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_address TEXT NOT NULL,
    pool_id TEXT NOT NULL,
    tick_lower INTEGER NOT NULL,
    tick_upper INTEGER NOT NULL,
    liquidity TEXT NOT NULL,                          -- LP tokens amount (big number as string)
    amount0 TEXT NOT NULL,                            -- token0 amount
    amount1 TEXT NOT NULL,                            -- token1 amount
    fees_earned_token0 TEXT NOT NULL DEFAULT '0',
    fees_earned_token1 TEXT NOT NULL DEFAULT '0',
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY (user_address) REFERENCES users(address),
    FOREIGN KEY (pool_id) REFERENCES pools(pool_id)
);
INSERT OR IGNORE INTO liquidity_positions_final
    (id, user_address, pool_id, tick_lower, tick_upper, liquidity, amount0, amount1,
     fees_earned_token0, fees_earned_token1, is_active, created_at, updated_at)
  SELECT id, user_address, pool_id, tick_lower, tick_upper, liquidity, amount0, amount1,
         fees_earned_token0, fees_earned_token1, is_active, created_at, updated_at
  FROM liquidity_positions;
DROP TABLE liquidity_positions;
ALTER TABLE liquidity_positions_final RENAME TO liquidity_positions;
CREATE INDEX IF NOT EXISTS idx_lp_user ON liquidity_positions(user_address, is_active);
CREATE INDEX IF NOT EXISTS idx_lp_pool ON liquidity_positions(pool_id, is_active);

-- Sanity: no dangling FKs after the rebuild (runs regardless of enforcement mode).
PRAGMA foreign_key_check;
PRAGMA foreign_keys = on;
