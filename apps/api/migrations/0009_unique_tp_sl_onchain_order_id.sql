DROP INDEX IF EXISTS idx_tp_sl_orders_chain_onchain_id;

CREATE UNIQUE INDEX idx_tp_sl_orders_chain_onchain_id
  ON tp_sl_orders(chain_id, onchain_order_id);
