import { useAppKit } from "@reown/appkit/react"
import { createFileRoute } from "@tanstack/react-router"
import { Position as V3Position } from "@uniswap/v3-sdk"
import { type FormEvent, useEffect, useMemo, useState } from "react"
import { encodeFunctionData, getAddress, isAddress } from "viem"
import { useAccount, usePublicClient, useWalletClient } from "wagmi"
import { Card, CardBody, CardTitle } from "../components/ui/Card"
import { Input } from "../components/ui/Input"
import { submitProtectedRawTransaction } from "../lib/protected-submission"
import {
  buildRebalanceIntent,
  buildV4RebalanceCall,
  type RebalanceFormValues,
  type RebalancePosition,
  validateRebalanceForm,
} from "../lib/rebalance"
import { buildV3PoolContext, buildV3RebalancePlan, type V3Fee } from "../lib/v3-liquidity"
import { getV4PoolId } from "../lib/v4-liquidity"

export const Route = createFileRoute("/positions")({
  component: PositionsPage,
})

const initialValues: RebalanceFormValues = {
  lowerTick: "-1200",
  upperTick: "1200",
  slippage: "0.5",
  deadline: "1800",
}

interface IndexedPosition {
  readonly id: number
  readonly chainId?: number
  readonly protocol?: "v3" | "v4"
  readonly tokenId?: string | null
  readonly poolId: string
  readonly tickSpacing: number
  readonly tickLower: number
  readonly tickUpper: number
  readonly liquidity: string
  readonly poolToken0Address?: string
  readonly poolToken1Address?: string
  readonly poolToken0Decimals?: number
  readonly poolToken1Decimals?: number
  readonly poolFee?: number
  readonly poolHookAddress?: string | null
  readonly poolSqrtPriceX96?: string
  readonly poolCurrentTick?: number
  readonly poolLiquidity?: string
}

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:8080/api/v1"

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function isIndexedPosition(value: unknown): value is IndexedPosition {
  if (!isRecord(value)) return false
  const position = value
  return (
    typeof position.id === "number" &&
    (position.protocol === "v3" || position.protocol === "v4") &&
    (typeof position.tokenId === "string" || position.tokenId === null) &&
    typeof position.chainId === "number" &&
    typeof position.poolId === "string" &&
    typeof position.tickSpacing === "number" &&
    typeof position.tickLower === "number" &&
    typeof position.tickUpper === "number" &&
    typeof position.liquidity === "string"
  )
}

const ERC20_ABI = [
  {
    name: "allowance",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "approve",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    name: "decimals",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint8" }],
  },
] as const

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

const V3_POOL_ABI = [
  {
    name: "slot0",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { name: "sqrtPriceX96", type: "uint160" },
      { name: "tick", type: "int24" },
      { name: "observationIndex", type: "uint16" },
      { name: "observationCardinality", type: "uint16" },
      { name: "observationCardinalityNext", type: "uint16" },
      { name: "feeProtocol", type: "uint8" },
      { name: "unlocked", type: "bool" },
    ],
  },
  {
    name: "liquidity",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint128" }],
  },
] as const

const V4_STATE_VIEW_ABI = [
  {
    name: "getSlot0",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "poolId", type: "bytes32" }],
    outputs: [
      { name: "sqrtPriceX96", type: "uint160" },
      { name: "tick", type: "int24" },
      { name: "protocolFee", type: "uint24" },
      { name: "lpFee", type: "uint24" },
    ],
  },
  {
    name: "getLiquidity",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "poolId", type: "bytes32" }],
    outputs: [{ name: "liquidity", type: "uint128" }],
  },
] as const

function isIndexedPositionResponse(value: unknown): value is { readonly positions: readonly IndexedPosition[] } {
  if (!isRecord(value)) return false
  const positions = value.positions
  return Array.isArray(positions) && positions.every(isIndexedPosition)
}

function toRebalancePosition(position: IndexedPosition): RebalancePosition {
  return {
    positionId: `#${position.id}`,
    poolId: position.poolId,
    pair: "Token 0 / Token 1",
    token0: "Token 0",
    token1: "Token 1",
    currentLowerTick: position.tickLower,
    currentUpperTick: position.tickUpper,
    tickSpacing: position.tickSpacing,
    liquidity: position.liquidity,
  }
}

export function selectIndexedPosition(
  positions: readonly IndexedPosition[],
  selectedId: number | null,
): IndexedPosition | null {
  return positions.find((position) => position.id === selectedId) ?? positions[0] ?? null
}

function PositionsPage() {
  const { open } = useAppKit()
  const { address, isConnected } = useAccount()
  const publicClient = usePublicClient()
  const { data: walletClient } = useWalletClient()
  const [positions, setPositions] = useState<IndexedPosition[]>([])
  const [isPending, setIsPending] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [selectedPositionId, setSelectedPositionId] = useState<number | null>(null)
  const [values, setValues] = useState<RebalanceFormValues>(initialValues)
  const [submitted, setSubmitted] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [transactionHash, setTransactionHash] = useState<`0x${string}` | null>(null)
  const indexedSelectedPosition = selectIndexedPosition(positions, selectedPositionId)
  const selectedPosition = indexedSelectedPosition ? toRebalancePosition(indexedSelectedPosition) : null
  const validation = useMemo(
    () => validateRebalanceForm(values, selectedPosition?.tickSpacing ?? 60),
    [values, selectedPosition],
  )
  const intent = useMemo(
    () => (validation.valid && selectedPosition ? buildRebalanceIntent(selectedPosition, values) : null),
    [validation.valid, selectedPosition, values],
  )

  useEffect(() => {
    if (!isConnected || !address) {
      setPositions([])
      setSelectedPositionId(null)
      setErrorMessage(null)
      return
    }
    const controller = new AbortController()
    let active = true
    setIsPending(true)
    setErrorMessage(null)
    fetch(`${API_URL}/users/${encodeURIComponent(address)}/positions`, { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        return response.json()
      })
      .then((response: unknown) => {
        if (!isIndexedPositionResponse(response)) throw new Error("Unexpected positions response")
        if (!active) return
        setPositions([...response.positions])
        setSelectedPositionId((current) =>
          response.positions.some((position) => position.id === current)
            ? current
            : (response.positions[0]?.id ?? null),
        )
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return
        if (active) {
          setPositions([])
          setSelectedPositionId(null)
          setErrorMessage(error instanceof Error ? error.message : "Unknown request error")
        }
      })
      .finally(() => {
        if (active) setIsPending(false)
      })
    return () => {
      active = false
      controller.abort()
    }
  }, [address, isConnected])

  const updateValue = (field: keyof RebalanceFormValues, value: string) => {
    setSubmitted(false)
    setTransactionHash(null)
    setValues((current) => ({ ...current, [field]: value }))
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setSubmitted(true)
    setTransactionHash(null)
    if (!intent || !indexedSelectedPosition) return
    if (!indexedSelectedPosition.protocol || indexedSelectedPosition.chainId === undefined) return
    if (!address || !walletClient || !publicClient) return
    const managerAddress =
      indexedSelectedPosition.protocol === "v4"
        ? import.meta.env.VITE_POSITION_MANAGER_ADDRESS
        : import.meta.env.VITE_V3_POSITION_MANAGER_ADDRESS
    const privateRpcUrl = import.meta.env.VITE_PRIVATE_RPC_URL
    if (!managerAddress || !isAddress(managerAddress)) {
      setErrorMessage(`${indexedSelectedPosition.protocol.toUpperCase()} position manager is not configured`)
      return
    }
    if (!privateRpcUrl) {
      setErrorMessage("Protected submission is not configured")
      return
    }
    if (indexedSelectedPosition.protocol === "v3") {
      if (!indexedSelectedPosition.tokenId || !isAddress(indexedSelectedPosition.poolId)) {
        setErrorMessage("Indexed v3 position is missing its pool address; rebalance is unavailable")
        return
      }
      setIsSubmitting(true)
      setErrorMessage(null)
      try {
        const tokenId = BigInt(indexedSelectedPosition.tokenId)
        const manager = getAddress(managerAddress)
        const owner = await publicClient.readContract({
          address: manager,
          abi: V3_POSITION_MANAGER_ABI,
          functionName: "ownerOf",
          args: [tokenId],
        })
        if (owner.toLowerCase() !== address.toLowerCase())
          throw new Error("Connected wallet does not own this v3 position")
        const onchainPosition = await publicClient.readContract({
          address: manager,
          abi: V3_POSITION_MANAGER_ABI,
          functionName: "positions",
          args: [tokenId],
        })
        const [, , token0, token1, fee, tickLower, tickUpper, liquidity, , , tokensOwed0, tokensOwed1] = onchainPosition
        if (liquidity === 0n) throw new Error("V3 position has no active liquidity")
        if (tickLower !== indexedSelectedPosition.tickLower || tickUpper !== indexedSelectedPosition.tickUpper) {
          throw new Error("Indexed v3 position metadata does not match on-chain state")
        }
        const poolAddress = getAddress(indexedSelectedPosition.poolId)
        const [slot0, poolLiquidity, token0Decimals, token1Decimals] = await Promise.all([
          publicClient.readContract({ address: poolAddress, abi: V3_POOL_ABI, functionName: "slot0" }),
          publicClient.readContract({ address: poolAddress, abi: V3_POOL_ABI, functionName: "liquidity" }),
          publicClient.readContract({ address: getAddress(token0), abi: ERC20_ABI, functionName: "decimals" }),
          publicClient.readContract({ address: getAddress(token1), abi: ERC20_ABI, functionName: "decimals" }),
        ])
        const [sqrtPriceX96, currentTick] = slot0
        if (sqrtPriceX96 === 0n || poolLiquidity === 0n) throw new Error("V3 pool has no active liquidity")
        const v3Pool = buildV3PoolContext({
          chainId: indexedSelectedPosition.chainId,
          token0: getAddress(token0),
          token1: getAddress(token1),
          token0Decimals,
          token1Decimals,
          fee: fee as V3Fee,
          sqrtPriceX96,
          liquidity: poolLiquidity,
          currentTick,
        })
        const currentPosition = new V3Position({
          pool: v3Pool.pool,
          tickLower,
          tickUpper,
          liquidity: liquidity.toString(),
        })
        const plan = buildV3RebalancePlan({
          pool: v3Pool,
          tokenId,
          currentLiquidity: liquidity,
          expectedOwed0: tokensOwed0,
          expectedOwed1: tokensOwed1,
          recipient: getAddress(address),
          currentRange: { tickLower, tickUpper },
          newRange: { tickLower: intent.newRange.lowerTick, tickUpper: intent.newRange.upperTick },
          amount0: BigInt(currentPosition.mintAmounts.amount0.toString()),
          amount1: BigInt(currentPosition.mintAmounts.amount1.toString()),
          slippageBps: intent.slippageBps,
          deadline: BigInt(Math.floor(Date.now() / 1000) + intent.deadlineSeconds),
        })
        const approvals = [
          { token: getAddress(token0), amount: BigInt(currentPosition.mintAmounts.amount0.toString()) },
          { token: getAddress(token1), amount: BigInt(currentPosition.mintAmounts.amount1.toString()) },
        ]
        for (const approval of approvals) {
          if (approval.amount === 0n) continue
          const allowance = await publicClient.readContract({
            address: approval.token,
            abi: ERC20_ABI,
            functionName: "allowance",
            args: [address, manager],
          })
          if (allowance >= approval.amount) continue
          const preparedApproval = await walletClient.prepareTransactionRequest({
            account: address,
            to: approval.token,
            data: encodeFunctionData({ abi: ERC20_ABI, functionName: "approve", args: [manager, approval.amount] }),
            value: 0n,
          })
          const signedApproval = await walletClient.signTransaction(preparedApproval)
          const approvalHash = await submitProtectedRawTransaction({
            rpcUrl: privateRpcUrl,
            signedTransaction: signedApproval,
          })
          await publicClient.waitForTransactionReceipt({ hash: approvalHash })
        }
        const prepared = await walletClient.prepareTransactionRequest({
          account: address,
          to: manager,
          data: plan.method.calldata as `0x${string}`,
          value: 0n,
        })
        const signed = await walletClient.signTransaction(prepared)
        const txHash = await submitProtectedRawTransaction({ rpcUrl: privateRpcUrl, signedTransaction: signed })
        setTransactionHash(txHash)
      } catch (error: unknown) {
        setErrorMessage(error instanceof Error ? error.message : "Unable to submit v3 rebalance")
      } finally {
        setIsSubmitting(false)
      }
      return
    }
    if (
      !indexedSelectedPosition.tokenId ||
      !indexedSelectedPosition.poolToken0Address ||
      !indexedSelectedPosition.poolToken1Address ||
      indexedSelectedPosition.poolToken0Decimals === undefined ||
      indexedSelectedPosition.poolToken1Decimals === undefined ||
      indexedSelectedPosition.poolFee === undefined ||
      !indexedSelectedPosition.poolHookAddress
    ) {
      setErrorMessage("Indexed position is missing pool metadata; rebalance is unavailable")
      return
    }
    if (indexedSelectedPosition.poolHookAddress === "0x0000000000000000000000000000000000000000") {
      setErrorMessage("V4 pool hook metadata is invalid")
      return
    }
    setIsSubmitting(true)
    setErrorMessage(null)
    try {
      const tokenId = BigInt(indexedSelectedPosition.tokenId)
      const blockNumber = await publicClient.getBlockNumber()
      const stateViewAddress = import.meta.env.VITE_STATE_VIEW_ADDRESS
      if (!stateViewAddress || !isAddress(stateViewAddress)) throw new Error("V4 StateView is not configured")
      const owner = await publicClient.readContract({
        address: getAddress(managerAddress),
        abi: POSITION_MANAGER_ABI,
        functionName: "ownerOf",
        args: [tokenId],
        blockNumber,
      })
      if (owner.toLowerCase() !== address.toLowerCase()) throw new Error("Connected wallet does not own this position")
      const onchainPosition = await publicClient.readContract({
        address: getAddress(managerAddress),
        abi: POSITION_MANAGER_ABI,
        functionName: "getPosition",
        args: [tokenId],
        blockNumber,
      })
      if (onchainPosition.liquidity === 0n) throw new Error("Position has no active liquidity")
      if (
        onchainPosition.poolKey.currency0 === "0x0000000000000000000000000000000000000000" ||
        onchainPosition.poolKey.currency1 === "0x0000000000000000000000000000000000000000"
      ) {
        throw new Error("Native-currency v4 rebalance requires payable settlement support")
      }
      if (
        onchainPosition.poolKey.currency0.toLowerCase() !== indexedSelectedPosition.poolToken0Address.toLowerCase() ||
        onchainPosition.poolKey.currency1.toLowerCase() !== indexedSelectedPosition.poolToken1Address.toLowerCase() ||
        onchainPosition.poolKey.fee !== indexedSelectedPosition.poolFee ||
        onchainPosition.poolKey.tickSpacing !== indexedSelectedPosition.tickSpacing ||
        onchainPosition.poolKey.hooks.toLowerCase() !== indexedSelectedPosition.poolHookAddress.toLowerCase()
      ) {
        throw new Error("Indexed pool metadata does not match the on-chain position")
      }
      const poolId = getV4PoolId({
        chainId: indexedSelectedPosition.chainId,
        token0: getAddress(onchainPosition.poolKey.currency0),
        token1: getAddress(onchainPosition.poolKey.currency1),
        token0Decimals: indexedSelectedPosition.poolToken0Decimals,
        token1Decimals: indexedSelectedPosition.poolToken1Decimals,
        fee: onchainPosition.poolKey.fee,
        tickSpacing: onchainPosition.poolKey.tickSpacing,
        hooks: getAddress(onchainPosition.poolKey.hooks),
      })
      const [slot0, poolLiquidity] = await Promise.all([
        publicClient.readContract({
          address: getAddress(stateViewAddress),
          abi: V4_STATE_VIEW_ABI,
          functionName: "getSlot0",
          args: [poolId],
          blockNumber,
        }),
        publicClient.readContract({
          address: getAddress(stateViewAddress),
          abi: V4_STATE_VIEW_ABI,
          functionName: "getLiquidity",
          args: [poolId],
          blockNumber,
        }),
      ])
      const [sqrtPriceX96, currentTick] = slot0
      if (sqrtPriceX96 === 0n || poolLiquidity === 0n) throw new Error("V4 pool has no active liquidity")
      const call = buildV4RebalanceCall({
        managerAddress: getAddress(managerAddress),
        pool: {
          chainId: indexedSelectedPosition.chainId,
          token0: getAddress(onchainPosition.poolKey.currency0),
          token1: getAddress(onchainPosition.poolKey.currency1),
          token0Decimals: indexedSelectedPosition.poolToken0Decimals,
          token1Decimals: indexedSelectedPosition.poolToken1Decimals,
          fee: onchainPosition.poolKey.fee,
          tickSpacing: onchainPosition.poolKey.tickSpacing,
          hooks: getAddress(onchainPosition.poolKey.hooks),
          sqrtPriceX96,
          poolLiquidity,
          currentTick,
        },
        tokenId,
        currentLiquidity: onchainPosition.liquidity,
        currentRange: { tickLower: onchainPosition.tickLower, tickUpper: onchainPosition.tickUpper },
        newRange: { tickLower: intent.newRange.lowerTick, tickUpper: intent.newRange.upperTick },
        slippageBps: intent.slippageBps,
        deadline: BigInt(Math.floor(Date.now() / 1000) + intent.deadlineSeconds),
      })
      const tokenApprovals = [
        { address: getAddress(onchainPosition.poolKey.currency0), amount: call.args[0].amount0Max },
        { address: getAddress(onchainPosition.poolKey.currency1), amount: call.args[0].amount1Max },
      ]
      for (const approval of tokenApprovals) {
        const allowance = await publicClient.readContract({
          address: approval.address,
          abi: ERC20_ABI,
          functionName: "allowance",
          args: [address, getAddress(managerAddress)],
        })
        if (allowance >= approval.amount) continue
        const preparedApproval = await walletClient.prepareTransactionRequest({
          account: address,
          to: approval.address,
          data: encodeFunctionData({
            abi: ERC20_ABI,
            functionName: "approve",
            args: [getAddress(managerAddress), approval.amount],
          }),
          value: 0n,
        })
        const signedApproval = await walletClient.signTransaction(preparedApproval)
        const approvalHash = await submitProtectedRawTransaction({
          rpcUrl: privateRpcUrl,
          signedTransaction: signedApproval,
        })
        await publicClient.waitForTransactionReceipt({ hash: approvalHash })
      }
      const prepared = await walletClient.prepareTransactionRequest({
        account: address,
        to: getAddress(managerAddress),
        data: call.calldata,
        value: 0n,
      })
      const signed = await walletClient.signTransaction(prepared)
      const txHash = await submitProtectedRawTransaction({ rpcUrl: privateRpcUrl, signedTransaction: signed })
      setTransactionHash(txHash)
    } catch (error: unknown) {
      setErrorMessage(error instanceof Error ? error.message : "Unable to submit rebalance")
    } finally {
      setIsSubmitting(false)
    }
  }

  if (!isConnected) {
    return (
      <div className="mx-auto max-w-5xl space-y-6 py-6">
        <PageHeading />
        <Card>
          <CardBody className="items-center py-12 text-center">
            <span className="badge badge-primary badge-outline">Wallet required</span>
            <CardTitle className="mt-3">Connect your wallet</CardTitle>
            <p className="max-w-md text-base-content/60">Your indexed positions will appear here after connection.</p>
            <button type="button" className="btn btn-primary mt-2" onClick={() => open()}>
              Connect wallet
            </button>
          </CardBody>
        </Card>
      </div>
    )
  }

  if (isPending) {
    return (
      <div className="mx-auto max-w-5xl space-y-6 py-6">
        <PageHeading />
        <Card>
          <CardBody className="items-center py-12">
            <span className="loading loading-spinner loading-lg text-primary" />
          </CardBody>
        </Card>
      </div>
    )
  }

  if (errorMessage || !selectedPosition) {
    return (
      <div className="mx-auto max-w-5xl space-y-6 py-6">
        <PageHeading />
        <Card>
          <CardBody className="items-center py-12 text-center">
            <CardTitle>{errorMessage ? "Couldn’t load positions" : "No indexed positions yet"}</CardTitle>
            <p className="max-w-md text-sm text-base-content/60">
              {errorMessage
                ? `The positions index returned ${errorMessage}.`
                : "Provide liquidity first, then return here to rebalance it."}
            </p>
          </CardBody>
        </Card>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6 py-6">
      <div>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-3xl font-bold">Positions</h1>
          <span className="badge badge-warning">Indexed position</span>
        </div>
        <p className="mt-2 text-base-content/60">
          Prepare a protected close, collect, and re-mint sequence for a position you control.
        </p>
      </div>

      <Card>
        <CardBody>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-xs uppercase tracking-[0.18em] text-base-content/50">Selected position</p>
              <CardTitle className="mt-1">{selectedPosition.pair}</CardTitle>
              <p className="font-mono text-xs text-base-content/60">
                {selectedPosition.positionId} · {selectedPosition.poolId}
              </p>
            </div>
            <span className="badge badge-success badge-outline">From position index</span>
          </div>
          {positions.length > 1 ? (
            <label className="form-control mt-5 max-w-md">
              <span className="label-text text-xs uppercase tracking-[0.18em] text-base-content/50">Position</span>
              <select
                className="select select-bordered mt-2 w-full font-mono text-sm"
                value={selectedPositionId ?? ""}
                onChange={(event) => setSelectedPositionId(Number(event.target.value))}
              >
                {positions.map((position) => (
                  <option key={position.id} value={position.id}>
                    #{position.id} · {position.tickLower} to {position.tickUpper}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <div className="mt-5 grid gap-4 sm:grid-cols-3">
            <PositionValue
              label="Current range"
              value={`${selectedPosition.currentLowerTick} to ${selectedPosition.currentUpperTick}`}
            />
            <PositionValue label="Liquidity" value={`${selectedPosition.liquidity} ${selectedPosition.token0}`} />
            <PositionValue label="Tick spacing" value={`${selectedPosition.tickSpacing}`} mono />
          </div>
        </CardBody>
      </Card>

      <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
        <Card>
          <CardBody>
            <CardTitle>New range and protection</CardTitle>
            <p className="mb-2 text-sm text-base-content/60">
              V3 and v4 NFT positions are verified against their position manager before protected submission. Legacy
              router and incomplete indexed positions remain gated.
            </p>
            <form className="space-y-4" onSubmit={handleSubmit}>
              <div className="grid gap-4 sm:grid-cols-2">
                <Input
                  id="rebalance-lower-tick"
                  label="New lower tick"
                  type="number"
                  step={selectedPosition.tickSpacing}
                  value={values.lowerTick}
                  {...inputError(validation.errors.lowerTick)}
                  onChange={(event) => updateValue("lowerTick", event.target.value)}
                />
                <Input
                  id="rebalance-upper-tick"
                  label="New upper tick"
                  type="number"
                  step={selectedPosition.tickSpacing}
                  value={values.upperTick}
                  {...inputError(validation.errors.upperTick)}
                  onChange={(event) => updateValue("upperTick", event.target.value)}
                />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <Input
                  id="rebalance-slippage"
                  label="Max slippage (%)"
                  type="number"
                  min="0"
                  max="5"
                  step="0.1"
                  value={values.slippage}
                  {...inputError(validation.errors.slippage)}
                  onChange={(event) => updateValue("slippage", event.target.value)}
                />
                <Input
                  id="rebalance-deadline"
                  label="Deadline (seconds)"
                  type="number"
                  min="60"
                  max="86400"
                  step="60"
                  value={values.deadline}
                  {...inputError(validation.errors.deadline)}
                  onChange={(event) => updateValue("deadline", event.target.value)}
                />
              </div>
              <button type="submit" className="btn btn-primary w-full" disabled={!validation.valid || isSubmitting}>
                {isSubmitting ? "Submitting rebalance…" : "Rebalance position"}
              </button>
              {submitted && intent && !transactionHash ? (
                <p className="text-sm text-warning" role="status">
                  The position manager will be checked on-chain before signing.
                </p>
              ) : null}
              {transactionHash ? (
                <p className="text-sm text-success" role="status">
                  Rebalance submitted: <span className="font-mono">{transactionHash}</span>
                </p>
              ) : null}
            </form>
          </CardBody>
        </Card>

        <Card>
          <CardBody>
            <div className="flex items-center justify-between gap-3">
              <CardTitle>Execution sequence</CardTitle>
              <span className="badge badge-success badge-outline">Protected</span>
            </div>
            <p className="mt-2 text-sm text-base-content/60">
              V4 submission verifies NFT ownership and the manager’s current position, then signs approvals and the
              atomic close-and-re-mint through the configured private RPC.
            </p>
            <ol className="mt-5 space-y-4">
              {[
                ["01", "Close", "Burn the selected position liquidity."],
                ["02", "Collect", "Collect the position tokens and accrued fees."],
                ["03", "Re-mint", "Mint the position using the new tick range."],
              ].map(([number, title, description]) => (
                <li className="flex gap-3" key={number}>
                  <span className="badge badge-primary badge-outline font-mono">{number}</span>
                  <div>
                    <p className="font-medium">{title}</p>
                    <p className="text-sm text-base-content/60">{description}</p>
                  </div>
                </li>
              ))}
            </ol>
            <div className="alert alert-info mt-6 items-start text-sm">
              <span>
                Legacy positions, missing pool metadata, native-currency pools, and unconfigured deployments remain
                gated. A successful v4 submission shows its transaction hash above.
              </span>
            </div>
            {intent ? (
              <div className="mt-4 rounded-box border border-base-300 p-3 text-xs text-base-content/60">
                <p className="font-mono">
                  Range: {intent.newRange.lowerTick} to {intent.newRange.upperTick}
                </p>
                <p className="font-mono">
                  Protection: {intent.slippageBps} bps · {intent.deadlineSeconds}s
                </p>
              </div>
            ) : null}
          </CardBody>
        </Card>
      </div>
    </div>
  )
}

function PageHeading() {
  return (
    <div>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-3xl font-bold">Positions</h1>
        <span className="badge badge-warning">Rebalance</span>
      </div>
      <p className="mt-2 text-base-content/60">
        Prepare a protected close, collect, and re-mint sequence for a position you control.
      </p>
    </div>
  )
}

function PositionValue({
  label,
  value,
  mono = false,
}: {
  readonly label: string
  readonly value: string
  readonly mono?: boolean
}) {
  return (
    <div>
      <p className="text-xs text-base-content/50">{label}</p>
      <p className={mono ? "font-mono text-sm" : "text-sm"}>{value}</p>
    </div>
  )
}

function inputError(error: string | undefined): { readonly error: string } | Record<string, never> {
  return error ? { error } : {}
}
