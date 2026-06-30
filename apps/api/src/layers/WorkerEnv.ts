import { Context, Layer } from "effect"

export interface WorkerEnv {
  readonly DB: D1Database
  readonly CACHE: KVNamespace
  readonly STORAGE: R2Bucket
  readonly ORDER_BOOK: DurableObjectNamespace
  readonly WEBSOCKET_HUB: DurableObjectNamespace
  readonly CHAIN_ID: string
  readonly ENVIRONMENT: string
}

export const WorkerEnv = Context.GenericTag<WorkerEnv>("@aetherdex/WorkerEnv")

export const makeWorkerEnvLayer = (env: WorkerEnv): Layer.Layer<WorkerEnv> => Layer.succeed(WorkerEnv, env)
