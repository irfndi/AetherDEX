import { type QueryFunctionContext, queryOptions } from "@tanstack/react-query"
import { Effect } from "effect"
import { type ListPoolsOptions, listPools } from "./api"

export type PoolsQueryFilters = Pick<ListPoolsOptions, "sortBy" | "sortDirection" | "filterToken">

/**
 * TanStack-Query resolver for the shared, typed AetherDEX pools API. The query
 * function runs the Effect program (`listPools`) which decodes the response
 * with the shared `PoolListResponseSchema`, so the data is typed end-to-end
 * from the `@aetherdex/shared` contract into the UI. The TanStack `context`
 * abort signal is forwarded to fetch so cancelled/unmounted queries stop the
 * in-flight request.
 */
export function poolsQueryOptions(limit = 50, offset = 0, filters: PoolsQueryFilters = {}) {
  return queryOptions({
    queryKey: [
      "pools",
      {
        limit,
        offset,
        sortBy: filters.sortBy ?? "tvl",
        sortDirection: filters.sortDirection ?? "desc",
        filterToken: filters.filterToken ?? "",
      },
    ],
    queryFn: (context: QueryFunctionContext) =>
      Effect.runPromise(listPools(limit, offset, { ...filters, signal: context.signal })),
  })
}
