/**
 * Server implementation of the shared `PoolsRpcGroup` contract.
 *
 * Handlers are typed against `@aetherdex/shared` (`PoolsRpcGroup.of`), so the
 * server provably honors the shared RpcGroup/Schema contract and delegates to
 * the Effect `PoolService`. `PoolsRpcHandlersLayer` is the Effect layer that
 * would back an `@effect/rpc` protocol server; the beta RPC-over-HTTP server is
 * not mounted yet (see PR notes), so the same data is currently served through
 * the Hono `/api/v1/pools` route resolved via PoolService.
 */

import { PoolsRpcGroup } from "@aetherdex/shared"
import { Effect } from "effect"
import { PoolService } from "../services/pool.service"

export const PoolsRpcHandlers = PoolsRpcGroup.of({
  listPools: (payload) =>
    Effect.gen(function* () {
      const poolService = yield* PoolService
      return yield* poolService.listPools({ limit: payload.limit, offset: payload.offset })
    }),
})

export const PoolsRpcHandlersLayer = PoolsRpcGroup.toLayer(PoolsRpcHandlers)
