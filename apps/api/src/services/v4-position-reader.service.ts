import { Context, Effect, Layer } from "effect"
import { createPublicClient, getAddress, http } from "viem"

const POSITION_MANAGER_ABI = [
  {
    name: "ownerOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [{ name: "", type: "address" }],
  },
  {
    name: "getPosition",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [
      {
        name: "position",
        type: "tuple",
        components: [
          {
            name: "poolKey",
            type: "tuple",
            components: [
              { name: "currency0", type: "address" },
              { name: "currency1", type: "address" },
              { name: "fee", type: "uint24" },
              { name: "tickSpacing", type: "int24" },
              { name: "hooks", type: "address" },
            ],
          },
          { name: "tickLower", type: "int24" },
          { name: "tickUpper", type: "int24" },
          { name: "liquidity", type: "uint128" },
          { name: "salt", type: "bytes32" },
        ],
      },
    ],
  },
] as const

const UINT256_MAX = 2n ** 256n - 1n

export const isValidV4TokenId = (tokenId: string): boolean => {
  if (!/^\d+$/.test(tokenId)) return false
  return BigInt(tokenId) <= UINT256_MAX
}

export interface V4PositionState {
  readonly owner: `0x${string}`
  readonly poolKey: {
    readonly currency0: `0x${string}`
    readonly currency1: `0x${string}`
    readonly fee: number
    readonly tickSpacing: number
    readonly hooks: `0x${string}`
  }
  readonly tickLower: number
  readonly tickUpper: number
  readonly liquidity: bigint
}

export class V4PositionReadError {
  readonly _tag = "V4PositionReadError"
  constructor(readonly message: string) {}
}

export interface V4PositionReader {
  readonly read: (tokenId: string) => Effect.Effect<V4PositionState, V4PositionReadError>
}

export const V4PositionReader = Context.Service<V4PositionReader>("@aetherdex/V4PositionReader")

export interface V4PositionReaderDeps {
  readonly rpcUrl: string
  readonly managerAddress: `0x${string}`
  readonly chainId: number
}

export const V4PositionReaderDeps = Context.Service<V4PositionReaderDeps>("@aetherdex/V4PositionReaderDeps")

const makeV4PositionReader = (deps: V4PositionReaderDeps): V4PositionReader => {
  const client = createPublicClient({ transport: http(deps.rpcUrl) })
  return {
    read: (tokenId) =>
      Effect.gen(function* () {
        if (!isValidV4TokenId(tokenId)) return yield* Effect.fail(new V4PositionReadError("Invalid token id"))
        const id = BigInt(tokenId)
        const chainId = yield* Effect.tryPromise({
          try: () => client.getChainId(),
          catch: (error) => new V4PositionReadError(`Unable to read v4 chain id: ${String(error)}`),
        })
        if (chainId !== deps.chainId)
          return yield* Effect.fail(
            new V4PositionReadError(`V4 RPC chain mismatch: expected ${deps.chainId}, received ${chainId}`),
          )
        const blockNumber = yield* Effect.tryPromise({
          try: () => client.getBlockNumber(),
          catch: (error) => new V4PositionReadError(`Unable to read v4 block number: ${String(error)}`),
        })
        const owner = yield* Effect.tryPromise({
          try: () =>
            client.readContract({
              address: deps.managerAddress,
              abi: POSITION_MANAGER_ABI,
              functionName: "ownerOf",
              args: [id],
              blockNumber,
            }),
          catch: (error) => new V4PositionReadError(`Unable to read v4 position owner: ${String(error)}`),
        })
        const position = yield* Effect.tryPromise({
          try: () =>
            client.readContract({
              address: deps.managerAddress,
              abi: POSITION_MANAGER_ABI,
              functionName: "getPosition",
              args: [id],
              blockNumber,
            }),
          catch: (error) => new V4PositionReadError(`Unable to read v4 position: ${String(error)}`),
        })
        if (position.liquidity === 0n)
          return yield* Effect.fail(new V4PositionReadError("Position has no active liquidity"))
        return {
          owner: getAddress(owner),
          poolKey: {
            currency0: getAddress(position.poolKey.currency0),
            currency1: getAddress(position.poolKey.currency1),
            fee: position.poolKey.fee,
            tickSpacing: position.poolKey.tickSpacing,
            hooks: getAddress(position.poolKey.hooks),
          },
          tickLower: position.tickLower,
          tickUpper: position.tickUpper,
          liquidity: position.liquidity,
        } satisfies V4PositionState
      }),
  }
}

export const V4PositionReaderLive = Layer.effect(
  V4PositionReader,
  Effect.gen(function* () {
    return makeV4PositionReader(yield* V4PositionReaderDeps)
  }),
)
