PRAGMA foreign_keys = off;

CREATE TABLE pools_chain_keys (
    chain_id INTEGER NOT NULL DEFAULT 1,
    pool_id TEXT NOT NULL,
    token0_address TEXT NOT NULL,
    token1_address TEXT NOT NULL,
    fee INTEGER NOT NULL,
    tick_spacing INTEGER NOT NULL,
    hook_address TEXT,
    sqrt_price_x96 TEXT NOT NULL,
    current_tick INTEGER NOT NULL,
    liquidity TEXT NOT NULL,
    tvl_usd REAL NOT NULL DEFAULT 0,
    volume_24h_usd REAL NOT NULL DEFAULT 0,
    fees_24h_usd REAL NOT NULL DEFAULT 0,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (chain_id, pool_id)
);
INSERT INTO pools_chain_keys
SELECT chain_id, pool_id, token0_address, token1_address, fee, tick_spacing, hook_address, sqrt_price_x96,
       current_tick, liquidity, tvl_usd, volume_24h_usd, fees_24h_usd, is_active, created_at, updated_at
FROM pools;

CREATE TABLE transactions_chain_keys (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    chain_id INTEGER NOT NULL DEFAULT 1,
    tx_hash TEXT NOT NULL,
    user_address TEXT NOT NULL,
    pool_id TEXT,
    tx_type TEXT NOT NULL,
    token_in TEXT,
    token_out TEXT,
    amount_in TEXT,
    amount_out TEXT,
    amount_usd REAL,
    gas_used INTEGER,
    gas_price TEXT,
    block_number INTEGER NOT NULL,
    block_timestamp INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at INTEGER NOT NULL,
    UNIQUE (chain_id, tx_hash),
    FOREIGN KEY (user_address) REFERENCES users(address),
    FOREIGN KEY (chain_id, pool_id) REFERENCES pools_chain_keys(chain_id, pool_id)
);
INSERT INTO transactions_chain_keys
SELECT id, chain_id, tx_hash, user_address, pool_id, tx_type, token_in, token_out, amount_in, amount_out,
       amount_usd, gas_used, gas_price, block_number, block_timestamp, status, created_at
FROM transactions;

CREATE TABLE liquidity_positions_chain_keys (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    chain_id INTEGER NOT NULL DEFAULT 1,
    protocol TEXT NOT NULL DEFAULT 'v4',
    token_id TEXT,
    user_address TEXT NOT NULL,
    pool_id TEXT NOT NULL,
    tick_lower INTEGER NOT NULL,
    tick_upper INTEGER NOT NULL,
    liquidity TEXT NOT NULL,
    amount0 TEXT NOT NULL,
    amount1 TEXT NOT NULL,
    fees_earned_token0 TEXT NOT NULL DEFAULT '0',
    fees_earned_token1 TEXT NOT NULL DEFAULT '0',
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    cost_basis_token0 TEXT NOT NULL DEFAULT '0',
    cost_basis_token1 TEXT NOT NULL DEFAULT '0',
    FOREIGN KEY (user_address) REFERENCES users(address),
    FOREIGN KEY (chain_id, pool_id) REFERENCES pools_chain_keys(chain_id, pool_id)
);
INSERT INTO liquidity_positions_chain_keys
SELECT id, chain_id, protocol, token_id, user_address, pool_id, tick_lower, tick_upper, liquidity, amount0, amount1,
       fees_earned_token0, fees_earned_token1, is_active, created_at, updated_at, cost_basis_token0, cost_basis_token1
FROM liquidity_positions;

DROP TABLE liquidity_positions;
DROP TABLE transactions;
DROP TABLE pools;
ALTER TABLE pools_chain_keys RENAME TO pools;
ALTER TABLE transactions_chain_keys RENAME TO transactions;
ALTER TABLE liquidity_positions_chain_keys RENAME TO liquidity_positions;

CREATE INDEX idx_pools_chain_active ON pools(chain_id, is_active, tvl_usd DESC);
CREATE INDEX idx_pools_chain_tokens ON pools(chain_id, token0_address, token1_address);
CREATE INDEX idx_tx_chain_user ON transactions(chain_id, user_address, block_timestamp DESC);
CREATE INDEX idx_tx_chain_pool ON transactions(chain_id, pool_id, block_timestamp DESC);
CREATE INDEX idx_positions_chain_user ON liquidity_positions(chain_id, user_address, is_active);
CREATE INDEX idx_positions_chain_pool ON liquidity_positions(chain_id, pool_id, is_active);
CREATE UNIQUE INDEX idx_positions_chain_token
  ON liquidity_positions(chain_id, protocol, token_id) WHERE token_id IS NOT NULL;

PRAGMA foreign_key_check;
PRAGMA foreign_keys = on;
