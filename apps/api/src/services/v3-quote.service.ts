import { Context, Effect, Layer } from "effect"
import { type Address, createPublicClient, getAddress, http } from "viem"

const V3_FACTORY_ABI = [
  {
    name: "getPool",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "tokenA", type: "address" },
      { name: "tokenB", type: "address" },
      { name: "fee", type: "uint24" },
    ],
    outputs: [{ name: "pool", type: "address" }],
  },
] as const

const V3_QUOTER_ABI = [
  {
    name: "quoteExactInputSingle",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      {
        name: "params",
        type: "tuple",
        components: [
          { name: "tokenIn", type: "address" },
          { name: "tokenOut", type: "address" },
          { name: "amountIn", type: "uint256" },
          { name: "fee", type: "uint24" },
          { name: "sqrtPriceLimitX96", type: "uint160" },
        ],
      },
    ],
    outputs: [
      { name: "amountOut", type: "uint256" },
      { name: "sqrtPriceX96After", type: "uint160" },
      { name: "initializedTicksCrossed", type: "uint32" },
      { name: "gasEstimate", type: "uint256" },
    ],
  },
] as const

export interface V3QuoteParams {
  readonly tokenIn: string
  readonly tokenOut: string
  readonly fee: number
  readonly amountIn: bigint
  readonly sqrtPriceLimitX96?: bigint
}

export interface V3Quote {
  readonly amountOut: bigint
  readonly initializedTicksCrossed: number
  readonly gasEstimate: bigint
}

export class V3QuoteError {
  readonly _tag = "V3QuoteError"
  constructor(
    readonly reason: "not_configured" | "invalid_amount" | "no_pool" | "rpc_error",
    readonly message: string,
  ) {}
}

export interface V3QuoteService {
  readonly quote: (params: V3QuoteParams) => Effect.Effect<V3Quote, V3QuoteError>
}

export const V3QuoteService = Context.Service<V3QuoteService>("@aetherdex/V3QuoteService")

export interface V3QuoteServiceDeps {
  readonly rpcUrl: string
  readonly factoryAddress: `0x${string}`
  readonly quoterAddress: `0x${string}`
}

export const V3QuoteServiceDeps = Context.Service<V3QuoteServiceDeps>("@aetherdex/V3QuoteServiceDeps")

const makeV3QuoteService = (deps: V3QuoteServiceDeps): V3QuoteService => {
  const client = createPublicClient({ transport: http(deps.rpcUrl) })

  return {
    quote: (params) =>
      Effect.gen(function* () {
        if (params.amountIn <= 0n) {
          return yield* Effect.fail(new V3QuoteError("invalid_amount", "amountIn must be positive"))
        }
        let tokenIn: Address
        let tokenOut: Address
        try {
          tokenIn = getAddress(params.tokenIn)
          tokenOut = getAddress(params.tokenOut)
        } catch {
          return yield* Effect.fail(new V3QuoteError("rpc_error", "Invalid token address"))
        }
        const pool = yield* Effect.tryPromise({
          try: () =>
            client.readContract({
              address: deps.factoryAddress,
              abi: V3_FACTORY_ABI,
              functionName: "getPool",
              args: [tokenIn, tokenOut, params.fee],
            }),
          catch: (error) => new V3QuoteError("rpc_error", `V3 factory read failed: ${String(error)}`),
        })
        if (pool === "0x0000000000000000000000000000000000000000") {
          return yield* Effect.fail(new V3QuoteError("no_pool", "No v3 pool exists for this fee tier"))
        }
        const result = yield* Effect.tryPromise({
          try: () =>
            client.simulateContract({
              address: deps.quoterAddress,
              abi: V3_QUOTER_ABI,
              functionName: "quoteExactInputSingle",
              args: [
                {
                  tokenIn,
                  tokenOut,
                  amountIn: params.amountIn,
                  fee: params.fee,
                  sqrtPriceLimitX96: params.sqrtPriceLimitX96 ?? 0n,
                },
              ],
            }),
          catch: (error) => new V3QuoteError("rpc_error", `V3 quoter simulation failed: ${String(error)}`),
        })
        const [amountOut, , initializedTicksCrossed, gasEstimate] = result.result
        if (amountOut <= 0n) {
          return yield* Effect.fail(new V3QuoteError("rpc_error", "V3 quote returned zero output"))
        }
        return { amountOut, initializedTicksCrossed, gasEstimate }
      }),
  }
}

export const V3QuoteServiceLive = Layer.effect(
  V3QuoteService,
  Effect.gen(function* () {
    return makeV3QuoteService(yield* V3QuoteServiceDeps)
  }),
)
