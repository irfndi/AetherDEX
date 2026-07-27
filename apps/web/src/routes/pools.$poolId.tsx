import { useAppKit } from "@reown/appkit/react"
import { createFileRoute, Link } from "@tanstack/react-router"
import { type FormEvent, useEffect, useState } from "react"
import { encodeFunctionData, getAddress, type Hex, isAddress, parseEventLogs, parseUnits, zeroAddress } from "viem"
import { useAccount, usePublicClient, useWalletClient } from "wagmi"
import { DexScreenerChart } from "../components/DexScreenerChart"
import { RangeSelector } from "../components/RangeSelector"
import { TokenChip } from "../components/TokenChip"
import { Button, Card, CardBody, Input, Stat } from "../components/ui"
import { useSiweAuth } from "../hooks/useSiweAuth"
import {
  buildLiquidityRequest,
  LIQUIDITY_PROTOCOLS,
  type LiquidityFormValues,
  type LiquidityProtocol,
  type LiquiditySide,
  type LiquidityTransactionRequest,
  validateLiquidityForm,
} from "../lib/liquidity"
import { submitProtectedRawTransaction } from "../lib/protected-submission"
import { buildV3PoolContext, buildV3SingleSidedZapCall, findV3SwapAmount } from "../lib/v3-liquidity"
import { buildV4SingleSidedCall, findV4SwapAmount, getV4PoolId } from "../lib/v4-liquidity"

interface Pool {
  poolId: string
  token0Address: string
  token1Address: string
  hookAddress: string | null
  fee: number
  tickSpacing: number
  sqrtPriceX96: string
  currentTick: number
  liquidity: string
  tvlUsd: number
  volume24hUsd: number
  fees24hUsd: number
  isActive: boolean
}

interface Token {
  address: string
  symbol: string
  name: string
  decimals: number
  logoURI?: string
}

export const Route = createFileRoute("/pools/$poolId")({
  component: PoolDetailPage,
  loader: ({ params }) => ({ poolId: params.poolId }),
})

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:8080/api/v1"
const CHAIN_ID = Number(import.meta.env.VITE_CHAIN_ID ?? "11155111")
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
] as const
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
const V3_POOL_STATE_ABI = [
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
const POSITION_MANAGER_EVENTS_ABI = [
  {
    name: "Transfer",
    type: "event",
    inputs: [
      { name: "from", type: "address", indexed: true },
      { name: "to", type: "address", indexed: true },
      { name: "tokenId", type: "uint256", indexed: true },
    ],
  },
] as const

function PoolDetailPage() {
  const { poolId } = Route.useLoaderData()
  const [pool, setPool] = useState<Pool | null>(null)
  const [token0, setToken0] = useState<Token | null>(null)
  const [token1, setToken1] = useState<Token | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true)

    fetch(`${API_URL}/pools/${poolId}`)
      .then((r) => r.json())
      .then((data: { pool: Pool }) => {
        if (cancelled || !data.pool) return
        setPool(data.pool)

        return Promise.all([
          fetch(`${API_URL}/tokens/${data.pool.token0Address}`)
            .then((r) => r.json())
            .catch(() => null),
          fetch(`${API_URL}/tokens/${data.pool.token1Address}`)
            .then((r) => r.json())
            .catch(() => null),
        ]).then(([t0, t1]) => {
          if (cancelled) return
          if (t0?.token) setToken0(t0.token)
          if (t1?.token) setToken1(t1.token)
        })
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [poolId])

  if (loading) {
    return (
      <div className="mx-auto flex justify-center py-8">
        <span className="loading loading-spinner loading-lg" />
      </div>
    )
  }

  if (!pool) {
    return (
      <div className="mx-auto max-w-6xl py-8">
        <Card>
          <CardBody>
            <p className="py-8 text-center">Pool not found.</p>
            <div className="flex justify-center">
              <Link to="/pools" search={{ sortBy: "tvl", filterToken: "" }} className="btn btn-ghost btn-sm">
                ← Back to pools
              </Link>
            </div>
          </CardBody>
        </Card>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-6xl py-8">
      <div className="mb-6">
        <Link
          to="/pools"
          search={{ sortBy: "tvl", filterToken: "" }}
          className="text-sm text-base-content/60 hover:text-primary"
        >
          ← Back to pools
        </Link>
      </div>

      <div className="mb-6 flex items-center gap-3">
        {token0 ? <TokenChip token={token0} /> : null}
        <span className="text-2xl text-base-content/40">/</span>
        {token1 ? <TokenChip token={token1} /> : null}
        <span className="badge badge-ghost ml-2">{(pool.fee / 10_000).toFixed(2)}% fee</span>
      </div>

      <div className="stats stats-horizontal mb-6 bg-transparent">
        <Stat label="TVL" value={`$${formatUsd(pool.tvlUsd)}`} />
        <Stat label="Volume 24h" value={`$${formatUsd(pool.volume24hUsd)}`} />
        <Stat label="Fees 24h" value={`$${formatUsd(pool.fees24hUsd)}`} />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Card>
            <CardBody>
              <h2 className="card-title mb-4">Chart</h2>
              <DexScreenerChart tokenAddress={pool.token0Address} />
            </CardBody>
          </Card>
        </div>

        <div>
          <LiquidityForm pool={pool} token0={token0} token1={token1} />
        </div>
      </div>
    </div>
  )
}

interface LiquidityFormProps {
  readonly pool: Pool
  readonly token0: Token | null
  readonly token1: Token | null
}

function LiquidityForm({ pool, token0, token1 }: LiquidityFormProps) {
  const { open } = useAppKit()
  const { address, isConnected } = useAccount()
  const publicClient = usePublicClient()
  const { data: walletClient } = useWalletClient()
  const { signIn } = useSiweAuth()
  const [values, setValues] = useState<LiquidityFormValues>({
    protocol: "v4",
    tokenSide: "token0",
    amount: "",
    lowerTick: "-600",
    upperTick: "600",
    slippage: "0.5",
    deadline: "1800",
  })
  const [submitted, setSubmitted] = useState(false)
  const [request, setRequest] = useState<LiquidityTransactionRequest | null>(null)
  const [preparing, setPreparing] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const validation = validateLiquidityForm(values, pool.tickSpacing)
  const errors = submitted ? validation.errors : {}
  const selectedToken = values.tokenSide === "token0" ? token0 : token1
  const otherToken = values.tokenSide === "token0" ? token1 : token0
  const walletName = address ? `${address.slice(0, 6)}…${address.slice(-4)}` : "Wallet not connected"

  const updateValue = (field: keyof LiquidityFormValues, value: string) => {
    setValues((current) => ({ ...current, [field]: value }))
    setRequest(null)
    setErrorMessage(null)
  }

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setSubmitted(true)
    if (!isConnected) {
      open()
      return
    }

    const nextRequest = buildLiquidityRequest(pool.poolId, values, pool.tickSpacing)
    if (!nextRequest) return
    setErrorMessage(null)
    setPreparing(true)
    try {
      if (values.protocol === "v3") {
        if (!address || !walletClient || !publicClient) throw new Error("Wallet client is not ready")
        const walletChainId = walletClient.chain?.id ?? publicClient.chain?.id
        if (publicClient.chain?.id !== CHAIN_ID || walletChainId !== CHAIN_ID) {
          throw new Error(`Switch wallet to chain ${CHAIN_ID} before adding liquidity`)
        }
        const executorAddress = import.meta.env.VITE_V3_ZAP_EXECUTOR_ADDRESS
        const privateRpcUrl = import.meta.env.VITE_PRIVATE_RPC_URL
        if (!executorAddress || !isAddress(executorAddress)) throw new Error("V3 zap executor is not configured")
        if (!privateRpcUrl) throw new Error("Protected submission is not configured")
        if (!selectedToken || !otherToken || !token0 || !token1) throw new Error("Pool token metadata is incomplete")
        const amountIn = parseUnits(values.amount.trim(), selectedToken.decimals)
        const tokenInIsToken0 = selectedToken.address.toLowerCase() === pool.token0Address.toLowerCase()
        if (!tokenInIsToken0 && selectedToken.address.toLowerCase() !== pool.token1Address.toLowerCase()) {
          throw new Error("Selected token is not part of this pool")
        }
        const quote = async (swapAmountIn: bigint) => {
          const response = await fetch(
            `${API_URL}/v3/quote?tokenIn=${selectedToken.address}&tokenOut=${otherToken.address}&fee=${pool.fee}&amountIn=${swapAmountIn}&slippage=${values.slippage}`,
          )
          if (!response.ok) throw new Error(`V3 quote failed with HTTP ${response.status}`)
          const data = parseV3SwapQuote(await response.json())
          return { amountOut: BigInt(data.amountOut), minAmountOut: BigInt(data.minAmountOut) }
        }
        const v3FactoryAddress = import.meta.env.VITE_V3_FACTORY_ADDRESS
        if (!v3FactoryAddress || !isAddress(v3FactoryAddress)) throw new Error("V3 factory is not configured")
        const v3PoolAddress = await publicClient.readContract({
          address: getAddress(v3FactoryAddress),
          abi: V3_FACTORY_ABI,
          functionName: "getPool",
          args: [getAddress(pool.token0Address), getAddress(pool.token1Address), pool.fee],
        })
        if (v3PoolAddress === zeroAddress) throw new Error("V3 pool is not deployed for this pair")
        const blockNumber = await publicClient.getBlockNumber()
        const [slot0, v3Liquidity] = await Promise.all([
          publicClient.readContract({
            address: v3PoolAddress,
            abi: V3_POOL_STATE_ABI,
            functionName: "slot0",
            blockNumber,
          }),
          publicClient.readContract({
            address: v3PoolAddress,
            abi: V3_POOL_STATE_ABI,
            functionName: "liquidity",
            blockNumber,
          }),
        ])
        const [sqrtPriceX96, currentTick] = slot0
        if (sqrtPriceX96 === 0n || v3Liquidity === 0n) throw new Error("V3 pool has no active liquidity")
        const v3Pool = buildV3PoolContext({
          chainId: CHAIN_ID,
          token0: getAddress(pool.token0Address),
          token1: getAddress(pool.token1Address),
          token0Decimals: token0.decimals,
          token1Decimals: token1.decimals,
          fee: pool.fee as 100 | 500 | 3_000 | 10_000,
          sqrtPriceX96,
          liquidity: v3Liquidity,
          currentTick,
        })
        const search = await findV3SwapAmount({
          pool: v3Pool,
          tickLower: Number(values.lowerTick),
          tickUpper: Number(values.upperTick),
          amountIn,
          tokenInIsToken0,
          quote,
        })
        const remainingInput = amountIn - search.swapAmountIn
        const minRemainingInput = (remainingInput * BigInt(10_000 - nextRequest.slippageBps)) / 10_000n
        const call = buildV3SingleSidedZapCall({
          executor: getAddress(executorAddress),
          pool: v3Pool,
          tokenIn: getAddress(selectedToken.address),
          amountIn,
          swapAmountIn: search.swapAmountIn,
          minSwapAmountOut: search.quote.minAmountOut,
          amount0Min: tokenInIsToken0 ? minRemainingInput : search.quote.minAmountOut,
          amount1Min: tokenInIsToken0 ? search.quote.minAmountOut : minRemainingInput,
          tickLower: Number(values.lowerTick),
          tickUpper: Number(values.upperTick),
          slippageBps: nextRequest.slippageBps,
          deadline: BigInt(Math.floor(Date.now() / 1000) + nextRequest.deadlineSeconds),
        })
        const tokenAddress = getAddress(selectedToken.address)
        const executor = getAddress(executorAddress)
        const allowance = await publicClient.readContract({
          address: tokenAddress,
          abi: ERC20_ABI,
          functionName: "allowance",
          args: [address, executor],
        })
        if (allowance < amountIn) {
          const approvalPrepared = await walletClient.prepareTransactionRequest({
            account: address,
            to: tokenAddress,
            data: encodeFunctionData({ abi: ERC20_ABI, functionName: "approve", args: [executor, amountIn] }),
            value: 0n,
          })
          const approvalSigned = await walletClient.signTransaction(approvalPrepared)
          const approvalHash = await submitProtectedRawTransaction({
            rpcUrl: privateRpcUrl,
            signedTransaction: approvalSigned,
          })
          await publicClient.waitForTransactionReceipt({ hash: approvalHash })
        }
        const prepared = await walletClient.prepareTransactionRequest({
          account: address,
          to: executor,
          data: call.method.calldata as Hex,
          value: 0n,
        })
        const signedTransaction = await walletClient.signTransaction(prepared)
        const txHash = await submitProtectedRawTransaction({ rpcUrl: privateRpcUrl, signedTransaction })
        setRequest({ ...nextRequest, execution: { status: "submitted", txHash } })
        return
      }
      if (!address || !walletClient || !publicClient) throw new Error("Wallet client is not ready")
      const walletChainId = walletClient.chain?.id ?? publicClient.chain?.id
      if (publicClient.chain?.id !== CHAIN_ID || walletChainId !== CHAIN_ID) {
        throw new Error(`Switch wallet to chain ${CHAIN_ID} before adding liquidity`)
      }
      const positionManagerAddress = import.meta.env.VITE_POSITION_MANAGER_ADDRESS
      const privateRpcUrl = import.meta.env.VITE_PRIVATE_RPC_URL
      if (!positionManagerAddress || !isAddress(positionManagerAddress)) {
        throw new Error("V4 position manager is not configured")
      }
      if (!privateRpcUrl) throw new Error("Protected submission is not configured")
      if (!selectedToken || !otherToken || !token0 || !token1 || !pool.hookAddress || !isAddress(pool.hookAddress)) {
        throw new Error("Pool token metadata is incomplete")
      }
      const amountIn = parseUnits(values.amount.trim(), selectedToken.decimals)
      const zeroForOne = selectedToken.address.toLowerCase() === pool.token0Address.toLowerCase()
      if (!zeroForOne && selectedToken.address.toLowerCase() !== pool.token1Address.toLowerCase()) {
        throw new Error("Selected token is not part of this pool")
      }
      const quote = async (swapAmountIn: bigint) => {
        const response = await fetch(
          `${API_URL}/quote?tokenIn=${selectedToken.address}&tokenOut=${otherToken.address}&amountIn=${swapAmountIn}&slippage=${values.slippage}`,
        )
        if (!response.ok) throw new Error(`Quote failed with HTTP ${response.status}`)
        const data = parseSwapQuote(await response.json())
        return { amountOut: BigInt(data.amountOut), minAmountOut: BigInt(data.minAmountOut) }
      }
      const poolKey = {
        chainId: CHAIN_ID,
        token0: getAddress(pool.token0Address),
        token1: getAddress(pool.token1Address),
        token0Decimals: token0.decimals,
        token1Decimals: token1.decimals,
        fee: pool.fee,
        tickSpacing: pool.tickSpacing,
        hooks: getAddress(pool.hookAddress),
      } as const
      const stateViewAddress = import.meta.env.VITE_STATE_VIEW_ADDRESS
      if (!stateViewAddress || !isAddress(stateViewAddress)) throw new Error("V4 StateView is not configured")
      const blockNumber = await publicClient.getBlockNumber()
      const poolId = getV4PoolId(poolKey)
      const [slot0, v4Liquidity] = await Promise.all([
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
      if (sqrtPriceX96 === 0n || v4Liquidity === 0n) throw new Error("V4 pool has no active liquidity")
      const poolInput = {
        ...poolKey,
        sqrtPriceX96,
        liquidity: v4Liquidity,
        currentTick: Number(currentTick),
      } as const
      const search = await findV4SwapAmount({
        pool: poolInput,
        tickLower: Number(values.lowerTick),
        tickUpper: Number(values.upperTick),
        zeroForOne,
        amountIn,
        quote,
      })
      const call = buildV4SingleSidedCall({
        pool: poolInput,
        tickLower: Number(values.lowerTick),
        tickUpper: Number(values.upperTick),
        zeroForOne,
        amountIn,
        swapAmountIn: search.swapAmountIn,
        quotedAmountOut: search.quote.amountOut,
        minSwapAmountOut: search.quote.minAmountOut,
        slippageBps: nextRequest.slippageBps,
        deadline: BigInt(Math.floor(Date.now() / 1000) + nextRequest.deadlineSeconds),
        recipient: getAddress(address),
      })
      const tokenAddress = getAddress(selectedToken.address)
      const positionManager = getAddress(positionManagerAddress)
      const allowance = await publicClient.readContract({
        address: tokenAddress,
        abi: ERC20_ABI,
        functionName: "allowance",
        args: [address, positionManager],
      })
      if (allowance < amountIn) {
        const approvalPrepared = await walletClient.prepareTransactionRequest({
          account: address,
          to: tokenAddress,
          data: encodeFunctionData({
            abi: ERC20_ABI,
            functionName: "approve",
            args: [positionManager, amountIn],
          }),
          value: 0n,
        })
        const approvalSigned = await walletClient.signTransaction(approvalPrepared)
        const approvalHash = await submitProtectedRawTransaction({
          rpcUrl: privateRpcUrl,
          signedTransaction: approvalSigned,
        })
        await publicClient.waitForTransactionReceipt({ hash: approvalHash })
      }
      const prepared = await walletClient.prepareTransactionRequest({
        account: address,
        to: positionManager,
        data: call.calldata,
        value: 0n,
      })
      const signedTransaction = await walletClient.signTransaction(prepared)
      const txHash = await submitProtectedRawTransaction({ rpcUrl: privateRpcUrl, signedTransaction })
      const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash })
      const transfers = parseEventLogs({
        abi: POSITION_MANAGER_EVENTS_ABI,
        eventName: "Transfer",
        logs: receipt.logs,
        strict: false,
      })
      const positionTransfer = transfers.find(
        (log) =>
          log.address.toLowerCase() === positionManager.toLowerCase() &&
          typeof log.args.to === "string" &&
          log.args.to.toLowerCase() === address.toLowerCase(),
      )
      if (!positionTransfer) throw new Error("Confirmed V4 transaction did not emit a position NFT transfer")
      const tokenId = positionTransfer.args.tokenId
      if (typeof tokenId !== "bigint") throw new Error("Confirmed V4 position transfer did not include a tokenId")
      let authToken = localStorage.getItem("aetherdex-auth-token")
      if (!authToken) {
        await signIn()
        authToken = localStorage.getItem("aetherdex-auth-token")
      }
      if (!authToken) throw new Error("Sign-in is required to index the new position")
      const indexResponse = await fetch(`${API_URL}/positions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${authToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          protocol: "v4",
          tokenId: tokenId.toString(),
          poolId: pool.poolId,
          tickLower: Number(values.lowerTick),
          tickUpper: Number(values.upperTick),
          liquidity: call.liquidityDelta.toString(),
          amount0: call.expectedAmount0.toString(),
          amount1: call.expectedAmount1.toString(),
        }),
      })
      if (!indexResponse.ok) throw new Error(`Position indexing failed with HTTP ${indexResponse.status}`)
      setRequest({ ...nextRequest, execution: { status: "submitted", txHash } })
    } catch (error: unknown) {
      setErrorMessage(error instanceof Error ? error.message : "Unable to prepare liquidity transaction")
    } finally {
      setPreparing(false)
    }
  }

  return (
    <Card>
      <CardBody>
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 className="card-title">Add liquidity</h2>
            <p className="mt-1 text-sm text-base-content/60">Choose a range and deposit from one side.</p>
          </div>
          <span className={`badge ${isConnected ? "badge-success" : "badge-warning"}`}>
            {isConnected ? "Connected" : "Connect wallet"}
          </span>
        </div>

        <div className="mb-5 rounded-box border border-base-300 bg-base-100 p-3 text-sm">
          <div className="flex items-center justify-between gap-3">
            <span className="text-base-content/60">Wallet</span>
            {isConnected ? (
              <span className="font-mono text-xs">{walletName}</span>
            ) : (
              <Button type="button" variant="outline" size="xs" onClick={() => open()}>
                Connect
              </Button>
            )}
          </div>
        </div>

        <form onSubmit={submit} noValidate className="space-y-4">
          <fieldset>
            <legend className="label-text mb-2 block text-sm font-medium">Pool protocol</legend>
            <div className="join mb-4 w-full">
              {LIQUIDITY_PROTOCOLS.map((protocol: LiquidityProtocol) => (
                <button
                  className={`join-item btn btn-sm flex-1 ${values.protocol === protocol ? "btn-primary" : "btn-ghost"}`}
                  key={protocol}
                  type="button"
                  aria-pressed={values.protocol === protocol}
                  onClick={() => updateValue("protocol", protocol)}
                >
                  Uniswap {protocol}
                </button>
              ))}
            </div>
            <p className="mb-4 text-xs text-base-content/60">
              V3 uses QuoterV2 plus the Aether zap executor; V4 uses the Aether position manager. Both remain
              execution-gated until their deployed addresses and protected submission route are configured.
            </p>
          </fieldset>

          <fieldset>
            <legend className="label-text mb-2 block text-sm font-medium">Deposit from</legend>
            <div className="join w-full">
              {(["token0", "token1"] as const).map((side: LiquiditySide) => {
                const token = side === "token0" ? token0 : token1
                return (
                  <button
                    className={`join-item btn btn-sm flex-1 ${values.tokenSide === side ? "btn-primary" : "btn-ghost"}`}
                    key={side}
                    type="button"
                    aria-pressed={values.tokenSide === side}
                    onClick={() => updateValue("tokenSide", side)}
                  >
                    {token?.symbol ?? (side === "token0" ? "Token 0" : "Token 1")}
                  </button>
                )
              })}
            </div>
          </fieldset>

          <Input
            id="liquidity-amount"
            label={`Amount (${selectedToken?.symbol ?? "selected token"})`}
            inputMode="decimal"
            min="0"
            step="any"
            placeholder="0.00"
            value={values.amount}
            {...(errors.amount ? { error: errors.amount } : {})}
            onChange={(event) => updateValue("amount", event.target.value)}
          />

          <div>
            <div className="mb-2 flex items-center justify-between">
              <span className="label-text text-sm font-medium">Price range</span>
              <span className="text-xs text-base-content/60">Tick spacing: {pool.tickSpacing}</span>
            </div>
            <RangeSelector
              currentTick={pool.currentTick}
              lowerTick={parseTick(values.lowerTick, pool.currentTick - pool.tickSpacing * 10)}
              tickSpacing={pool.tickSpacing}
              upperTick={parseTick(values.upperTick, pool.currentTick + pool.tickSpacing * 10)}
              onChange={({ lowerTick, upperTick }) => {
                setValues((current) => ({ ...current, lowerTick: String(lowerTick), upperTick: String(upperTick) }))
                setRequest(null)
              }}
            />
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Input
                id="liquidity-lower-tick"
                label="Lower tick"
                type="number"
                step={pool.tickSpacing}
                value={values.lowerTick}
                {...(errors.lowerTick ? { error: errors.lowerTick } : {})}
                onChange={(event) => updateValue("lowerTick", event.target.value)}
              />
              <Input
                id="liquidity-upper-tick"
                label="Upper tick"
                type="number"
                step={pool.tickSpacing}
                value={values.upperTick}
                {...(errors.upperTick ? { error: errors.upperTick } : {})}
                onChange={(event) => updateValue("upperTick", event.target.value)}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Input
              id="liquidity-slippage"
              label="Max slippage (%)"
              type="number"
              min="0"
              max="5"
              step="0.1"
              value={values.slippage}
              {...(errors.slippage ? { error: errors.slippage } : {})}
              onChange={(event) => updateValue("slippage", event.target.value)}
            />
            <Input
              id="liquidity-deadline"
              label="Deadline (seconds)"
              type="number"
              min="60"
              max="86400"
              step="60"
              value={values.deadline}
              {...(errors.deadline ? { error: errors.deadline } : {})}
              onChange={(event) => updateValue("deadline", event.target.value)}
            />
          </div>

          <div className="rounded-box border border-base-300 bg-base-100 p-3 text-xs text-base-content/60">
            <div className="flex justify-between gap-3">
              <span>Range</span>
              <span className="font-mono">
                {values.lowerTick || "—"} to {values.upperTick || "—"}
              </span>
            </div>
            <div className="mt-2 flex justify-between gap-3">
              <span>Other side</span>
              <span>{otherToken?.symbol ?? "Token unavailable"} calculated at execution</span>
            </div>
          </div>

          {request ? (
            <div role="status" className="alert alert-warning text-sm">
              <span>
                {request.execution.status === "submitted"
                  ? `Protected transaction submitted: ${request.execution.txHash}`
                  : "V3 execution requires QuoterV2, zap executor, and protected RPC configuration."}
              </span>
            </div>
          ) : null}
          {errorMessage ? (
            <p className="text-sm text-error" role="alert">
              {errorMessage}
            </p>
          ) : null}

          <Button
            type="submit"
            variant="primary"
            fullWidth
            disabled={isConnected && (!validation.valid || request !== null)}
          >
            {preparing
              ? "Preparing protected transaction…"
              : request
                ? "Transaction submitted"
                : isConnected
                  ? "Add liquidity privately"
                  : "Connect wallet to continue"}
          </Button>
        </form>

        <div className="divider">Pool info</div>
        <div className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-base-content/60">Current tick</span>
            <span className="font-mono text-xs">{pool.currentTick}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-base-content/60">Liquidity</span>
            <span className="font-mono text-xs">{pool.liquidity.slice(0, 10)}…</span>
          </div>
        </div>
      </CardBody>
    </Card>
  )
}

function parseTick(value: string, fallback: number): number {
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) ? parsed : fallback
}

function parseSwapQuote(value: unknown): { readonly amountOut: string; readonly minAmountOut: string } {
  if (typeof value !== "object" || value === null) throw new Error("Unexpected quote response")
  const quote = value as { readonly amountOut?: unknown; readonly minAmountOut?: unknown }
  if (typeof quote.amountOut !== "string" || typeof quote.minAmountOut !== "string") {
    throw new Error("Quote response is missing amount bounds")
  }
  return { amountOut: quote.amountOut, minAmountOut: quote.minAmountOut }
}

function parseV3SwapQuote(value: unknown): { readonly amountOut: string; readonly minAmountOut: string } {
  return parseSwapQuote(value)
}

function formatUsd(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`
  if (value >= 1_000) return `${(value / 1_000).toFixed(2)}K`
  if (value >= 1) return value.toFixed(2)
  if (value > 0) return value.toFixed(4)
  return "0.00"
}
