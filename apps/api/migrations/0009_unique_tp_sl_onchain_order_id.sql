DROP INDEX IF EXISTS idx_tp_sl_orders_chain_onchain_id;

WITH duplicate_map AS (
  SELECT duplicate.id AS duplicate_id, MIN(retained.id) AS retained_id
  FROM tp_sl_orders AS duplicate
  JOIN tp_sl_orders AS retained
    ON retained.chain_id = duplicate.chain_id
    AND retained.onchain_order_id = duplicate.onchain_order_id
    AND retained.id < duplicate.id
  WHERE duplicate.onchain_order_id IS NOT NULL
  GROUP BY duplicate.id
)
UPDATE keeper_executions
SET order_id = (
  SELECT retained_id
  FROM duplicate_map
  WHERE duplicate_id = keeper_executions.order_id
)
WHERE order_id IN (SELECT duplicate_id FROM duplicate_map);

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
