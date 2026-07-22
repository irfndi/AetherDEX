import { queryOptions } from "@tanstack/react-query"
import { Effect } from "effect"
import { listPools } from "./api"

/**
 * TanStack-Query resolver for the shared, typed AetherDEX pools API. The query
 * function runs the Effect program (`listPools`) which decodes the response
 * with the shared `PoolListResponseSchema`, so the data is typed end-to-end
 * from the `@aetherdex/shared` contract into the UI.
 */
export function poolsQueryOptions(limit = 50, offset = 0) {
  return queryOptions({
    queryKey: ["pools", { limit, offset }],
    queryFn: () => Effect.runPromise(listPools(limit, offset)),
  })
}
