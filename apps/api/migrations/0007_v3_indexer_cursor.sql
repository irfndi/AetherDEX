CREATE TABLE IF NOT EXISTS indexer_cursors (
    chain_id INTEGER NOT NULL,
    indexer TEXT NOT NULL,
    next_block INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (chain_id, indexer)
);
