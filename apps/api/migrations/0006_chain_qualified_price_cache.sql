CREATE TABLE IF NOT EXISTS price_cache_chain (
    token_address TEXT NOT NULL,
    chain_id INTEGER NOT NULL,
    price_usd REAL NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (token_address, chain_id)
);

INSERT OR IGNORE INTO price_cache_chain (token_address, chain_id, price_usd, updated_at)
SELECT token_address, 1, price_usd, updated_at FROM price_cache;

DROP TABLE price_cache;
ALTER TABLE price_cache_chain RENAME TO price_cache;
CREATE INDEX IF NOT EXISTS idx_price_updated ON price_cache(updated_at DESC);
