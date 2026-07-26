import { createFileRoute } from "@tanstack/react-router"
import { useState } from "react"
import { encodeFunctionData, getAddress, isAddress } from "viem"
import { useAccount, usePublicClient, useWalletClient } from "wagmi"
import { Button, Card, CardBody, CardTitle, Input } from "../components/ui"
import { submitProtectedRawTransaction } from "../lib/protected-submission"

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:8080/api/v1"
const FACTORY_ABI = [
  {
    name: "createPoolWithDeadline",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "token0", type: "address" },
      { name: "token1", type: "address" },
      { name: "fee", type: "uint24" },
      { name: "tickSpacing", type: "int24" },
      { name: "sqrtPriceX96", type: "uint160" },
      { name: "deadline", type: "uint256" },
    ],
    outputs: [{ name: "poolId", type: "bytes32" }],
  },
] as const

const Q96 = 2n ** 96n
const MAX_UINT160 = 2n ** 160n - 1n
const MAX_V4_FEE = 1_000_000
const MAX_V4_TICK_SPACING = 32_767
type PriceInput =
  | { readonly kind: "price"; readonly value: string }
  | { readonly kind: "sqrtPriceX96"; readonly value: string }

export interface PoolCreationFormValues {
  readonly token0: string
  readonly token0Decimals: string
  readonly token1: string
  readonly token1Decimals: string
  readonly fee: string
  readonly tickSpacing: string
  readonly priceInput: PriceInput
  readonly deadline: string
}

export interface PoolCreationRequest {
  readonly token0: `0x${string}`
  readonly token0Decimals: number
  readonly token1: `0x${string}`
  readonly token1Decimals: number
  readonly fee: number
  readonly tickSpacing: number
  readonly initialPrice: PriceInput
  readonly deadline: number
}

export interface PoolCreationValidation {
  readonly errors: Readonly<Partial<Record<keyof PoolCreationFormValues | "pair", string>>>
  readonly request: PoolCreationRequest | null
}

export function validatePoolCreationForm(
  values: PoolCreationFormValues,
  now = Math.floor(Date.now() / 1000),
): PoolCreationValidation {
  const errors: Partial<Record<keyof PoolCreationFormValues | "pair", string>> = {}
  const token0 = parseAddress(values.token0)
  const token1 = parseAddress(values.token1)
  const token0Decimals = parseTokenDecimals(values.token0Decimals)
  const token1Decimals = parseTokenDecimals(values.token1Decimals)
  const fee = parsePositiveInteger(values.fee)
  const tickSpacing = parsePositiveInteger(values.tickSpacing)
  const price = values.priceInput.value.trim()
  const deadline = parseDeadline(values.deadline)

  if (!token0) errors.token0 = "Enter a valid 0x address."
  if (!token1) errors.token1 = "Enter a valid 0x address."
  if (token0Decimals === null) errors.token0Decimals = "Token0 decimals must be an integer from 0 to 255."
  if (token1Decimals === null) errors.token1Decimals = "Token1 decimals must be an integer from 0 to 255."
  if (token0 && token1 && token0.toLowerCase() === token1.toLowerCase()) errors.pair = "Tokens must be distinct."
  if (token0 && token1 && token0.toLowerCase() > token1.toLowerCase()) {
    errors.pair = "Token0 must be the lower address."
  }
  if (fee === null) errors.fee = "Fee must be a positive integer."
  else if (fee > MAX_V4_FEE) errors.fee = `Fee must be at most ${MAX_V4_FEE}.`
  if (tickSpacing === null) errors.tickSpacing = "Tick spacing must be a positive integer."
  else if (tickSpacing > MAX_V4_TICK_SPACING)
    errors.tickSpacing = `Tick spacing must be at most ${MAX_V4_TICK_SPACING}.`
  if (!isPositiveDecimal(price)) errors.priceInput = "Initial price must be positive."
  if (values.priceInput.kind === "sqrtPriceX96" && !isPositiveInteger(price)) {
    errors.priceInput = "sqrtPriceX96 must be a positive integer."
  }
  if (values.priceInput.kind === "sqrtPriceX96" && isPositiveInteger(price) && BigInt(price) > MAX_UINT160) {
    errors.priceInput = "sqrtPriceX96 must fit in uint160."
  }
  if (
    values.priceInput.kind === "price" &&
    isPositiveDecimal(price) &&
    token0Decimals !== null &&
    token1Decimals !== null &&
    !isDecimalSqrtPriceWithinUint160(price, token0Decimals, token1Decimals)
  ) {
    errors.priceInput = "Initial price is outside the uint160 sqrt-price range."
  }
  if (
    values.priceInput.kind === "price" &&
    isPositiveDecimal(price) &&
    token0Decimals !== null &&
    token1Decimals !== null &&
    decimalToSqrtPriceX96(price, token0Decimals, token1Decimals) === 0n
  ) {
    errors.priceInput = "Initial price is too small to encode as sqrtPriceX96."
  }
  if (deadline === null || deadline <= now) errors.deadline = "Deadline must be a future date and time."

  if (
    Object.keys(errors).length > 0 ||
    !token0 ||
    !token1 ||
    token0Decimals === null ||
    token1Decimals === null ||
    fee === null ||
    tickSpacing === null ||
    deadline === null
  ) {
    return { errors, request: null }
  }

  return {
    errors,
    request: {
      token0,
      token0Decimals,
      token1,
      token1Decimals,
      fee,
      tickSpacing,
      initialPrice: values.priceInput,
      deadline,
    },
  }
}

export function buildPoolCreationTransactionIntent(request: PoolCreationRequest) {
  const sqrtPriceX96 =
    request.initialPrice.kind === "sqrtPriceX96"
      ? BigInt(request.initialPrice.value)
      : decimalToSqrtPriceX96(request.initialPrice.value, request.token0Decimals, request.token1Decimals)
  return {
    functionName: "createPoolWithDeadline" as const,
    args: [
      request.token0,
      request.token1,
      request.fee,
      request.tickSpacing,
      sqrtPriceX96,
      BigInt(request.deadline),
    ] as const,
    deadline: request.deadline,
  }
}

function parseAddress(value: string): `0x${string}` | null {
  if (!isAddress(value)) return null
  try {
    return getAddress(value)
  } catch {
    return null
  }
}

function parsePositiveInteger(value: string): number | null {
  if (!/^\d+$/.test(value.trim())) return null
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null
}

function parseTokenDecimals(value: string): number | null {
  if (!/^\d+$/.test(value.trim())) return null
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed >= 0 && parsed <= 255 ? parsed : null
}

function isPositiveInteger(value: string): boolean {
  return /^\d+$/.test(value.trim()) && BigInt(value) > 0n
}

function isPositiveDecimal(value: string): boolean {
  if (!/^\d+(\.\d+)?$/.test(value)) return false
  return Number(value) > 0
}

function isDecimalSqrtPriceWithinUint160(value: string, token0Decimals: number, token1Decimals: number): boolean {
  const [whole = ""] = value.split(".")
  if (whole.length > 40) return false
  return decimalToSqrtPriceX96(value, token0Decimals, token1Decimals) <= MAX_UINT160
}

function parseDeadline(value: string): number | null {
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) ? Math.floor(timestamp / 1000) : null
}

function deploymentConfig(): { readonly address: `0x${string}`; readonly chainId: number | null } | null {
  const address = import.meta.env.VITE_POOL_FACTORY_ADDRESS
  if (!address || !isAddress(address)) return null
  const chainIdValue = import.meta.env.VITE_POOL_FACTORY_CHAIN_ID
  const chainId = chainIdValue && /^\d+$/.test(chainIdValue) ? Number(chainIdValue) : null
  return { address: getAddress(address), chainId }
}

export const Route = createFileRoute("/pools/new")({ component: NewPoolPage })

function NewPoolPage() {
  const { address, isConnected } = useAccount()
  const publicClient = usePublicClient()
  const { data: walletClient } = useWalletClient()
  const config = deploymentConfig()
  const [values, setValues] = useStateWithFormDefaults()
  const [submitted, setSubmitted] = useState(false)
  const [recheckAcknowledged, setRecheckAcknowledged] = useState(false)
  const [intentPrepared, setIntentPrepared] = useState(false)
  const [guardChecking, setGuardChecking] = useState(false)
  const [txHash, setTxHash] = useState<`0x${string}` | null>(null)
  const [executionError, setExecutionError] = useState<string | null>(null)
  const validation = validatePoolCreationForm(values)
  const canPrepare = Boolean(isConnected && validation.request && recheckAcknowledged)

  const update = (field: keyof PoolCreationFormValues, value: string) => {
    setValues((current) => ({ ...current, [field]: value }))
    setSubmitted(false)
    setIntentPrepared(false)
    setTxHash(null)
    setExecutionError(null)
  }

  const submit = async () => {
    setSubmitted(true)
    setIntentPrepared(false)
    setTxHash(null)
    setExecutionError(null)
    if (!canPrepare || !validation.request) return

    setGuardChecking(true)
    try {
      const guardUrl = new URL(`${API_URL}/price-guard`)
      guardUrl.searchParams.set("token0", validation.request.token0)
      guardUrl.searchParams.set("token1", validation.request.token1)
      guardUrl.searchParams.set(
        "price",
        validation.request.initialPrice.kind === "price"
          ? validation.request.initialPrice.value
          : sqrtPriceToPrice(
              validation.request.initialPrice.value,
              validation.request.token0Decimals,
              validation.request.token1Decimals,
            ),
      )
      const guardResponse = await fetch(guardUrl)
      const guardPayload = (await guardResponse.json()) as { readonly error?: string; readonly valid?: boolean }
      if (!guardResponse.ok || guardPayload.valid !== true) {
        throw new Error(guardPayload.error ?? "Live price guard rejected this opening price")
      }

      if (!config) {
        setIntentPrepared(true)
        return
      }
      if (!address || !walletClient || !publicClient) throw new Error("Wallet client is not ready")
      if (!import.meta.env.VITE_PRIVATE_RPC_URL) throw new Error("Protected submission is not configured")
      if (config.chainId !== null && publicClient.chain?.id !== config.chainId) {
        throw new Error(`Switch to chain ${config.chainId} before creating the pool`)
      }
      const intent = buildPoolCreationTransactionIntent(validation.request)
      const prepared = await walletClient.prepareTransactionRequest({
        account: address,
        to: config.address,
        data: encodeFunctionData({
          abi: FACTORY_ABI,
          functionName: "createPoolWithDeadline",
          args: intent.args,
        }),
        value: 0n,
      })
      const signed = await walletClient.signTransaction(prepared)
      const hash = await submitProtectedRawTransaction({
        rpcUrl: import.meta.env.VITE_PRIVATE_RPC_URL,
        signedTransaction: signed,
      })
      setTxHash(hash)
      setIntentPrepared(true)
    } catch (error: unknown) {
      setExecutionError(error instanceof Error ? error.message : "Unable to create pool")
    } finally {
      setGuardChecking(false)
    }
  }

  const displayError = (field: keyof PoolCreationFormValues | "pair") =>
    submitted ? validation.errors[field] : undefined

  return (
    <div className="mx-auto max-w-3xl py-8">
      <div className="mb-6">
        <p className="mb-2 text-sm font-medium uppercase tracking-wide text-primary">Phase 1 · Pool creation</p>
        <h1 className="text-3xl font-bold">Create a new pool</h1>
        <p className="mt-2 max-w-2xl text-base-content/65">
          Define the pool key and opening price. Submission is gated by fresh form validation and an explicit
          execution-time price re-check acknowledgement.
        </p>
      </div>

      <Card>
        <CardBody className="gap-6">
          <section>
            <CardTitle className="mb-4 text-lg">Pool pair</CardTitle>
            <div className="grid gap-4 md:grid-cols-2">
              <Input
                id="token0"
                label="Token0 address"
                placeholder="0x…"
                value={values.token0}
                {...inputError(displayError("token0"))}
                onChange={(e) => update("token0", e.target.value)}
              />
              <Input
                id="token1"
                label="Token1 address"
                placeholder="0x…"
                value={values.token1}
                {...inputError(displayError("token1"))}
                onChange={(e) => update("token1", e.target.value)}
              />
              <Input
                id="token0-decimals"
                label="Token0 decimals"
                inputMode="numeric"
                placeholder="18"
                value={values.token0Decimals}
                {...inputError(displayError("token0Decimals"))}
                onChange={(e) => update("token0Decimals", e.target.value)}
              />
              <Input
                id="token1-decimals"
                label="Token1 decimals"
                inputMode="numeric"
                placeholder="6"
                value={values.token1Decimals}
                {...inputError(displayError("token1Decimals"))}
                onChange={(e) => update("token1Decimals", e.target.value)}
              />
            </div>
            {displayError("pair") ? <p className="mt-2 text-sm text-error">{displayError("pair")}</p> : null}
            <p className="mt-2 text-xs text-base-content/60">
              Addresses are normalized to checksum form and must be sorted token0 &lt; token1.
            </p>
          </section>

          <section>
            <CardTitle className="mb-4 text-lg">Pool parameters</CardTitle>
            <div className="grid gap-4 md:grid-cols-2">
              <Input
                id="fee"
                label="Fee (hundredths of a bip)"
                inputMode="numeric"
                placeholder="3000"
                value={values.fee}
                {...inputError(displayError("fee"))}
                onChange={(e) => update("fee", e.target.value)}
              />
              <Input
                id="tick-spacing"
                label="Tick spacing"
                inputMode="numeric"
                placeholder="60"
                value={values.tickSpacing}
                {...inputError(displayError("tickSpacing"))}
                onChange={(e) => update("tickSpacing", e.target.value)}
              />
            </div>
            <fieldset className="mt-4 flex flex-wrap gap-2">
              <legend className="sr-only">Initial price format</legend>
              <button
                type="button"
                className={`btn btn-sm ${values.priceInput.kind === "price" ? "btn-primary" : "btn-ghost border border-base-300"}`}
                onClick={() =>
                  setValues((current) => ({
                    ...current,
                    priceInput: { kind: "price", value: current.priceInput.value },
                  }))
                }
              >
                Price
              </button>
              <button
                type="button"
                className={`btn btn-sm ${values.priceInput.kind === "sqrtPriceX96" ? "btn-primary" : "btn-ghost border border-base-300"}`}
                onClick={() =>
                  setValues((current) => ({
                    ...current,
                    priceInput: { kind: "sqrtPriceX96", value: current.priceInput.value },
                  }))
                }
              >
                Sqrt price
              </button>
            </fieldset>
            <Input
              id="initial-price"
              label={
                values.priceInput.kind === "price" ? "Initial price (token1 per token0)" : "Initial sqrt price (Q64.96)"
              }
              inputMode="decimal"
              placeholder={values.priceInput.kind === "price" ? "1.0" : Q96.toString()}
              value={values.priceInput.value}
              {...inputError(displayError("priceInput"))}
              onChange={(e) =>
                setValues((current) => ({ ...current, priceInput: { ...current.priceInput, value: e.target.value } }))
              }
            />
          </section>

          <Input
            id="deadline"
            label="Transaction deadline"
            type="datetime-local"
            value={values.deadline}
            {...inputError(displayError("deadline"))}
            onChange={(e) => update("deadline", e.target.value)}
          />

          <div className="alert alert-warning items-start text-sm">
            <div>
              <p className="font-semibold">Execution-time price re-check required</p>
              <p>
                The opening price is checked against fresh API oracle prices immediately before any wallet signature.
              </p>
            </div>
          </div>
          <label className="label cursor-pointer justify-start gap-3">
            <input
              type="checkbox"
              className="checkbox checkbox-primary"
              checked={recheckAcknowledged}
              onChange={(e) => setRecheckAcknowledged(e.target.checked)}
            />
            <span className="label-text min-w-0 whitespace-normal break-words">
              I understand the price will be checked again at execution time.
            </span>
          </label>

          {!config ? (
            <p className="text-sm text-warning">
              Pool factory deployment is not configured for this environment. Intent preparation remains local.
            </p>
          ) : null}
          {config ? (
            <p className="text-sm text-warning">
              Factory address detected. A fresh price guard and protected submission are required before signing.
            </p>
          ) : null}
          {!isConnected ? (
            <p className="text-sm text-base-content/60">Connect a wallet to prepare a protected transaction.</p>
          ) : null}
          {executionError ? (
            <p className="alert alert-error text-sm" role="alert">
              {executionError}
            </p>
          ) : null}
          {intentPrepared ? (
            <p className="alert alert-warning text-sm" role="status">
              {txHash
                ? `Pool creation submitted privately: ${txHash}`
                : "Pool creation intent prepared after a fresh price guard."}
            </p>
          ) : null}
          <Button type="button" fullWidth disabled={!canPrepare || guardChecking} onClick={() => void submit()}>
            {guardChecking ? "Checking live price…" : config ? "Create pool privately" : "Prepare pool creation intent"}
          </Button>
        </CardBody>
      </Card>
    </div>
  )
}

function useStateWithFormDefaults() {
  const [values, setValues] = useState<PoolCreationFormValues>({
    token0: "",
    token0Decimals: "18",
    token1: "",
    token1Decimals: "18",
    fee: "3000",
    tickSpacing: "60",
    priceInput: { kind: "price", value: "1" },
    deadline: "",
  })
  return [values, setValues] as const
}

function inputError(error: string | undefined): { readonly error: string } | Record<string, never> {
  return error ? { error } : {}
}

function decimalToSqrtPriceX96(value: string, token0Decimals: number, token1Decimals: number): bigint {
  const [whole = "0", fraction = ""] = value.split(".")
  const valueScale = 10n ** BigInt(fraction.length)
  const valueNumerator = BigInt(whole) * valueScale + BigInt(fraction || "0")
  const numerator = valueNumerator * 10n ** BigInt(token1Decimals) * Q96 * Q96
  const denominator = valueScale * 10n ** BigInt(token0Decimals)
  return integerSqrt(numerator / denominator)
}

function integerSqrt(value: bigint): bigint {
  let result = value
  let next = (result + 1n) / 2n
  while (next < result) {
    result = next
    next = (result + value / result) / 2n
  }
  return result
}

export function sqrtPriceToPrice(value: string, token0Decimals: number, token1Decimals: number): string {
  const sqrtPriceX96 = BigInt(value)
  const numerator = sqrtPriceX96 * sqrtPriceX96 * 10n ** BigInt(token0Decimals)
  const denominator = 2n ** 192n * 10n ** BigInt(token1Decimals)
  const displayScale = 10n ** 18n
  const scaled = (numerator * displayScale) / denominator
  const whole = scaled / displayScale
  const fraction = (scaled % displayScale).toString().padStart(18, "0").replace(/0+$/, "")
  return fraction ? `${whole}.${fraction}` : whole.toString()
}
