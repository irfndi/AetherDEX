-- Chain-scope the token cache (Phase-0 review of PR #307).
--
-- Tokens are keyed by (chain_id, address): the SAME address on two chains is two
-- different tokens, so address alone must not be the key (cross-chain upserts from
-- the validated token list would otherwise overwrite each other's cache rows, and
-- reads could leak another chain's tokens). SQLite cannot re-key a PRIMARY KEY via
-- ALTER, so the table is rebuilt and data is carried over with chain_id = 1 (the
-- only chain indexed today).
CREATE TABLE IF NOT EXISTS tokens_chain_scoped (
    chain_id INTEGER NOT NULL,
    address TEXT NOT NULL,
    symbol TEXT NOT NULL,
    name TEXT NOT NULL,
    decimals INTEGER NOT NULL,
    logo_url TEXT,
    is_verified INTEGER NOT NULL DEFAULT 0,   -- 0/1 boolean
    is_native INTEGER NOT NULL DEFAULT 0,     -- 1 if this is native ETH/wrap
    total_supply TEXT,                        -- big number as string
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

-- The pools table carried address-only FOREIGN KEYs into tokens(address); with the
-- composite (chain_id, address) primary key above they are no longer satisfiable.
-- Pool tokens are not guaranteed to appear in the default token list at all, so the
-- FKs are dropped when pools is rebuilt (pool_id stays the primary key, keeping the
-- transactions / liquidity_positions FOREIGN KEYs into pools(pool_id) valid).
-- NOTE: pools itself becomes chain-qualified when the Phase-3 indexer ingests a
-- second chain (AGENTS.md "chain-qualified keys before a second chain is indexed").
CREATE TABLE IF NOT EXISTS pools_v2 (
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
    updated_at INTEGER NOT NULL
);
INSERT OR IGNORE INTO pools_v2
    (pool_id, token0_address, token1_address, fee, tick_spacing, hook_address, sqrt_price_x96, current_tick,
     liquidity, tvl_usd, volume_24h_usd, fees_24h_usd, is_active, created_at, updated_at)
  SELECT pool_id, token0_address, token1_address, fee, tick_spacing, hook_address, sqrt_price_x96, current_tick,
         liquidity, tvl_usd, volume_24h_usd, fees_24h_usd, is_active, created_at, updated_at
  FROM pools;
DROP TABLE pools;
ALTER TABLE pools_v2 RENAME TO pools;
CREATE INDEX IF NOT EXISTS idx_pools_active ON pools(is_active, tvl_usd DESC);
CREATE INDEX IF NOT EXISTS idx_pools_tokens ON pools(token0_address, token1_address);
