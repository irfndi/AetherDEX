ALTER TABLE tp_sl_orders ADD COLUMN onchain_order_id TEXT;

CREATE UNIQUE INDEX idx_tp_sl_orders_chain_onchain_id
  ON tp_sl_orders(chain_id, onchain_order_id);
