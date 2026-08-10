import { Rpc, RpcGroup } from "effect/unstable/rpc"
import { ListPoolsPayloadSchema, PoolListResponseSchema } from "./schema"

export const ListPools = Rpc.make("listPools", {
  payload: ListPoolsPayloadSchema,
  success: PoolListResponseSchema,
})

export const PoolsRpcGroup = RpcGroup.make(ListPools)
