DROP INDEX IF EXISTS idx_tp_sl_orders_chain_onchain_id;

DELETE FROM tp_sl_orders
WHERE id IN (
  SELECT id
  FROM (
    SELECT
      id,
      ROW_NUMBER() OVER (
        PARTITION BY chain_id, onchain_order_id
        ORDER BY id
      ) AS duplicate_rank
    FROM tp_sl_orders
    WHERE onchain_order_id IS NOT NULL
  )
  WHERE duplicate_rank > 1
);

CREATE UNIQUE INDEX idx_tp_sl_orders_chain_onchain_id
  ON tp_sl_orders(chain_id, onchain_order_id);
