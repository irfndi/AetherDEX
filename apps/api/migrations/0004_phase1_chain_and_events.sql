ALTER TABLE pools ADD COLUMN chain_id INTEGER NOT NULL DEFAULT 1;
ALTER TABLE transactions ADD COLUMN chain_id INTEGER NOT NULL DEFAULT 1;
ALTER TABLE liquidity_positions ADD COLUMN chain_id INTEGER NOT NULL DEFAULT 1;
ALTER TABLE liquidity_positions ADD COLUMN protocol TEXT NOT NULL DEFAULT 'v4';
ALTER TABLE liquidity_positions ADD COLUMN token_id TEXT;
ALTER TABLE liquidity_positions ADD COLUMN cost_basis_token0 TEXT NOT NULL DEFAULT '0';
ALTER TABLE liquidity_positions ADD COLUMN cost_basis_token1 TEXT NOT NULL DEFAULT '0';

CREATE UNIQUE INDEX IF NOT EXISTS idx_pools_chain_pool ON pools(chain_id, pool_id);
CREATE INDEX IF NOT EXISTS idx_pools_chain_active ON pools(chain_id, is_active, tvl_usd DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_transactions_chain_hash ON transactions(chain_id, tx_hash);
CREATE INDEX IF NOT EXISTS idx_transactions_chain_user ON transactions(chain_id, user_address, block_timestamp DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_positions_chain_token ON liquidity_positions(chain_id, protocol, token_id)
  WHERE token_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_positions_chain_user ON liquidity_positions(chain_id, user_address, is_active);

CREATE TABLE IF NOT EXISTS liquidity_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    chain_id INTEGER NOT NULL,
    protocol TEXT NOT NULL,
    event_type TEXT NOT NULL,
    tx_hash TEXT NOT NULL,
    log_index INTEGER NOT NULL,
    block_number INTEGER NOT NULL,
    block_timestamp INTEGER NOT NULL,
    pool_id TEXT,
    token_id TEXT,
    owner_address TEXT,
    tick_lower INTEGER,
    tick_upper INTEGER,
    liquidity_delta TEXT,
    amount0 TEXT,
    amount1 TEXT,
    created_at INTEGER NOT NULL,
    UNIQUE(chain_id, tx_hash, log_index)
);
CREATE INDEX IF NOT EXISTS idx_liquidity_events_position
  ON liquidity_events(chain_id, protocol, token_id, block_number);
CREATE INDEX IF NOT EXISTS idx_liquidity_events_owner
  ON liquidity_events(chain_id, owner_address, block_number DESC);

CREATE TABLE IF NOT EXISTS position_pnl_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    chain_id INTEGER NOT NULL,
    protocol TEXT NOT NULL,
    token_id TEXT NOT NULL,
    owner_address TEXT NOT NULL,
    amount0 TEXT NOT NULL,
    amount1 TEXT NOT NULL,
    fees0 TEXT NOT NULL DEFAULT '0',
    fees1 TEXT NOT NULL DEFAULT '0',
    value_usd REAL,
    snapshot_block INTEGER NOT NULL,
    snapshot_timestamp INTEGER NOT NULL,
    UNIQUE(chain_id, protocol, token_id, snapshot_block)
);
CREATE INDEX IF NOT EXISTS idx_position_pnl_owner
  ON position_pnl_snapshots(chain_id, owner_address, snapshot_timestamp DESC);
