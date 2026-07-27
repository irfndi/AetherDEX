import { type Address, createPublicClient, http } from "viem"

const V3_POSITION_MANAGER_ABI = [
  {
    name: "ownerOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [{ name: "", type: "address" }],
  },
  {
    name: "positions",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [
      { name: "nonce", type: "uint96" },
      { name: "operator", type: "address" },
      { name: "token0", type: "address" },
      { name: "token1", type: "address" },
      { name: "fee", type: "uint24" },
      { name: "tickLower", type: "int24" },
      { name: "tickUpper", type: "int24" },
      { name: "liquidity", type: "uint128" },
      { name: "feeGrowthInside0LastX128", type: "uint256" },
      { name: "feeGrowthInside1LastX128", type: "uint256" },
      { name: "tokensOwed0", type: "uint128" },
      { name: "tokensOwed1", type: "uint128" },
    ],
  },
] as const

export async function readV3PositionState(input: {
  readonly rpcUrl: string
  readonly managerAddress: Address
  readonly chainId: number
  readonly tokenId: string
}): Promise<{ readonly owner: Address; readonly liquidity: bigint }> {
  const client = createPublicClient({ transport: http(input.rpcUrl) })
  if ((await client.getChainId()) !== input.chainId) throw new Error("V3 RPC chain mismatch")
  const blockNumber = await client.getBlockNumber()
  const [owner, position] = await Promise.all([
    client.readContract({
      address: input.managerAddress,
      abi: V3_POSITION_MANAGER_ABI,
      functionName: "ownerOf",
      args: [BigInt(input.tokenId)],
      blockNumber,
    }),
    client.readContract({
      address: input.managerAddress,
      abi: V3_POSITION_MANAGER_ABI,
      functionName: "positions",
      args: [BigInt(input.tokenId)],
      blockNumber,
    }),
  ])
  return { owner, liquidity: position[7] }
}
