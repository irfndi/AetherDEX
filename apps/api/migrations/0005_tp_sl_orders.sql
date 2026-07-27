-- Phase 2: V4-native TP/SL orders
CREATE TABLE IF NOT EXISTS tp_sl_orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_address TEXT NOT NULL,
  pool_id TEXT NOT NULL,
  order_type TEXT NOT NULL CHECK (order_type IN ('take_profit', 'stop_loss')),
  zero_for_one INTEGER NOT NULL DEFAULT 0,
  amount_in TEXT NOT NULL,
  min_amount_out TEXT NOT NULL,
  trigger_price_x18 TEXT NOT NULL,
  twap_window INTEGER NOT NULL,
  slippage_bps INTEGER NOT NULL DEFAULT 500,
  deadline INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'triggered', 'executed', 'cancelled', 'expired')),
  created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  updated_at INTEGER,
  executed_at INTEGER,
  execution_tx_hash TEXT,
  execution_amount_out TEXT,
  chain_id INTEGER NOT NULL DEFAULT 11155111
);

CREATE INDEX idx_tp_sl_orders_user ON tp_sl_orders(chain_id, user_address);
CREATE INDEX idx_tp_sl_orders_pool ON tp_sl_orders(chain_id, pool_id);
CREATE INDEX idx_tp_sl_orders_pool_status ON tp_sl_orders(chain_id, pool_id, status);
CREATE INDEX idx_tp_sl_orders_chain_status ON tp_sl_orders(chain_id, status);

-- Keeper execution log for audit trail
CREATE TABLE IF NOT EXISTS keeper_executions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER,
  chain_id INTEGER NOT NULL DEFAULT 11155111,
  keeper_address TEXT NOT NULL,
  tx_hash TEXT NOT NULL,
  amount_out TEXT NOT NULL,
  gas_used INTEGER,
  executed_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  policy_triggered TEXT,
  FOREIGN KEY (order_id) REFERENCES tp_sl_orders(id)
);

CREATE INDEX idx_keeper_executions_order ON keeper_executions(chain_id, order_id);

CREATE TABLE IF NOT EXISTS auto_recenter_rebalances (
  request_id TEXT PRIMARY KEY,
  chain_id INTEGER NOT NULL,
  position_id TEXT NOT NULL,
  user_address TEXT NOT NULL,
  pool_id TEXT NOT NULL,
  target_tick_lower INTEGER NOT NULL,
  target_tick_upper INTEGER NOT NULL,
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'executed', 'failed')),
  created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);

CREATE INDEX idx_auto_recenter_rebalances_chain_position
  ON auto_recenter_rebalances(chain_id, position_id, status);

-- Position tracking for auto-recenter
CREATE TABLE IF NOT EXISTS position_policies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_address TEXT NOT NULL,
  position_id TEXT NOT NULL,
  pool_id TEXT NOT NULL,
  policy_type TEXT NOT NULL DEFAULT 'auto_recenter',
  is_active INTEGER NOT NULL DEFAULT 1,
  last_rebalance_at INTEGER,
  rebalance_count INTEGER NOT NULL DEFAULT 0,
  min_drift_bps INTEGER NOT NULL DEFAULT 500,
  cooldown_seconds INTEGER NOT NULL DEFAULT 3600,
  created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  chain_id INTEGER NOT NULL DEFAULT 11155111
);

CREATE INDEX idx_position_policies_user ON position_policies(chain_id, user_address);
CREATE INDEX idx_position_policies_active ON position_policies(is_active, chain_id);
