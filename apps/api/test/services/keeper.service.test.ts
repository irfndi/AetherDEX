/**
 * Keeper service — the tick result must not expose fake zero counters
 * (ordersTriggered/rebalancesQueued) that operators would mistake for real
 * activity while the evaluation paths are stubs.
 */

import { Effect, Layer } from "effect"
import { SqlClient } from "effect/unstable/sql"
import { describe, expect, it } from "vitest"
import { KeeperService, KeeperServiceLive } from "../../src/services/keeper.service"

const CHAIN_ID = 11155111

const fakeSqlLayer = (handler: (query: string) => unknown) => {
  const fakeSql = ((...parts: ReadonlyArray<unknown>) => {
    const query = String(parts[0] ?? "")
    return Effect.succeed(handler(query))
  }) as unknown as SqlClient.SqlClient
  return Layer.succeed(SqlClient.SqlClient, fakeSql)
}

const pendingOrderRow = {
  id: 1,
  pool_id: "0x00",
  trigger_price_x18: "1",
  twap_window: 300,
}

const activePolicyRow = {
  id: 1,
  user_address: "0x11",
  position_id: "pos-1",
  pool_id: "0x00",
  policy_type: "auto_recenter",
  is_active: 1,
  last_rebalance_at: null,
  rebalance_count: 0,
  min_drift_bps: 500,
  cooldown_seconds: 3600,
  created_at: 1,
  chain_id: CHAIN_ID,
}

describe("KeeperService.tick", () => {
  it("reports checked counts only — no stub ordersTriggered/rebalancesQueued zeros", async () => {
    const layer = fakeSqlLayer((query) => {
      if (query.includes("FROM tp_sl_orders")) return [pendingOrderRow]
      if (query.includes("FROM position_policies")) return [activePolicyRow]
      return []
    })
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* KeeperService
        return yield* svc.tick(CHAIN_ID)
      }).pipe(Effect.provide(KeeperServiceLive.pipe(Layer.provide(layer)))),
    )
    expect(result.ordersChecked).toBe(1)
    expect(result.ordersFailed).toBe(0)
    expect(result.positionsChecked).toBe(1)
    expect("ordersTriggered" in result).toBe(false)
    expect("rebalancesQueued" in result).toBe(false)
  })
})
