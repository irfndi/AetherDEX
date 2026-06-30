-- Seed data for local development
-- Common tokens on Sepolia/Base for testing
INSERT OR IGNORE INTO tokens (address, symbol, name, decimals, logo_url, is_verified, is_native, total_supply, created_at, updated_at) VALUES
    ('0x0000000000000000000000000000000000000000', 'ETH', 'Ethereum', 18, NULL, 1, 1, NULL, 1719715200, 1719715200),
    ('0x4200000000000000000000000000000000000006', 'WETH', 'Wrapped Ether', 18, NULL, 1, 0, NULL, 1719715200, 1719715200),
    ('0x6B3595068778DD592e39A122f4f5a5cF09C90fE2', 'SUSHI', 'SushiSwap', 18, NULL, 1, 0, '250000000', 1719715200, 1719715200),
    ('0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', 'USDC', 'USD Coin', 6, NULL, 1, 0, '1000000000', 1719715200, 1719715200),
    ('0xdAC17F958D2ee523a2206206994597C13D831ec7', 'USDT', 'Tether', 6, NULL, 1, 0, '1000000000', 1719715200, 1719715200);
