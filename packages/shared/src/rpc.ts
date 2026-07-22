import { Schema } from "effect"
import { Rpc, RpcGroup } from "effect/unstable/rpc"
import { ListPoolsPayloadSchema, PoolSchema } from "./schema"

export const ListPools = Rpc.make("listPools", {
  payload: ListPoolsPayloadSchema,
  success: Schema.Array(PoolSchema),
})

export const PoolsRpcGroup = RpcGroup.make(ListPools)
