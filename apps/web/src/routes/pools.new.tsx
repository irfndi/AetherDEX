import { createFileRoute } from "@tanstack/react-router"
import { useState } from "react"
import { getAddress, isAddress } from "viem"
import { useAccount, useChainId, useWriteContract } from "wagmi"
import { Button, Card, CardBody, CardTitle, Input } from "../components/ui"

const Q96 = 2n ** 96n
const FACTORY_ABI = [
  {
    type: "function",
    name: "createPool",
    stateMutability: "nonpayable",
    inputs: [
      { name: "token0", type: "address" },
      { name: "token1", type: "address" },
      { name: "fee", type: "uint24" },
      { name: "tickSpacing", type: "int24" },
      { name: "sqrtPriceX96", type: "uint160" },
    ],
    outputs: [{ name: "poolId", type: "bytes32" }],
  },
] as const

type PriceInput =
  | { readonly kind: "price"; readonly value: string }
  | { readonly kind: "sqrtPriceX96"; readonly value: string }

export interface PoolCreationFormValues {
  readonly token0: string
  readonly token1: string
  readonly fee: string
  readonly tickSpacing: string
  readonly priceInput: PriceInput
  readonly deadline: string
}

export interface PoolCreationRequest {
  readonly token0: `0x${string}`
  readonly token1: `0x${string}`
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
  const fee = parsePositiveInteger(values.fee)
  const tickSpacing = parsePositiveInteger(values.tickSpacing)
  const price = values.priceInput.value.trim()
  const deadline = parseDeadline(values.deadline)

  if (!token0) errors.token0 = "Enter a valid 0x address."
  if (!token1) errors.token1 = "Enter a valid 0x address."
  if (token0 && token1 && token0.toLowerCase() === token1.toLowerCase()) errors.pair = "Tokens must be distinct."
  if (token0 && token1 && token0.toLowerCase() > token1.toLowerCase()) {
    errors.pair = "Token0 must be the lower address."
  }
  if (fee === null) errors.fee = "Fee must be a positive integer."
  if (tickSpacing === null) errors.tickSpacing = "Tick spacing must be a positive integer."
  if (!isPositiveDecimal(price)) errors.priceInput = "Initial price must be positive."
  if (values.priceInput.kind === "sqrtPriceX96" && !isPositiveInteger(price)) {
    errors.priceInput = "sqrtPriceX96 must be a positive integer."
  }
  if (deadline === null || deadline <= now) errors.deadline = "Deadline must be a future date and time."

  if (
    Object.keys(errors).length > 0 ||
    !token0 ||
    !token1 ||
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
      token1,
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
      : decimalToSqrtPriceX96(request.initialPrice.value)
  return {
    functionName: "createPool" as const,
    args: [request.token0, request.token1, request.fee, request.tickSpacing, sqrtPriceX96] as const,
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

function isPositiveInteger(value: string): boolean {
  return /^\d+$/.test(value.trim()) && BigInt(value) > 0n
}

function isPositiveDecimal(value: string): boolean {
  if (!/^\d+(\.\d+)?$/.test(value)) return false
  return Number(value) > 0
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
  const chainId = useChainId()
  const { writeContractAsync, isPending } = useWriteContract()
  const config = deploymentConfig()
  const [values, setValues] = useStateWithFormDefaults()
  const [submitted, setSubmitted] = useState(false)
  const [recheckAcknowledged, setRecheckAcknowledged] = useState(false)
  const validation = validatePoolCreationForm(values)
  const chainReady = config !== null && (config.chainId === null || config.chainId === chainId)
  const canSubmit = Boolean(
    address && isConnected && chainReady && validation.request && recheckAcknowledged && !isPending,
  )

  const update = (field: keyof PoolCreationFormValues, value: string) => {
    setValues((current) => ({ ...current, [field]: value }))
    setSubmitted(false)
  }

  const submit = async () => {
    setSubmitted(true)
    if (!canSubmit || !validation.request || !config) return
    const intent = buildPoolCreationTransactionIntent(validation.request)
    await writeContractAsync({
      address: config.address,
      abi: FACTORY_ABI,
      functionName: intent.functionName,
      args: intent.args,
    })
  }

  const displayError = (field: keyof PoolCreationFormValues | "pair") =>
    submitted ? validation.errors[field] : undefined

  return (
    <div className="mx-auto max-w-3xl py-8">
      <div className="mb-6">
        <p className="mb-2 text-sm font-medium uppercase tracking-wide text-primary">Phase 1 · Pool creation</p>
        <h1 className="text-3xl font-bold">Create a new pool</h1>
        <p className="mt-2 max-w-2xl text-base-content/65">
          Define the pool key and opening price. The final transaction is guarded by a fresh execution-time price check
          before it can be submitted.
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
            <div className="mt-4 join w-full">
              <button
                type="button"
                className={`join-item btn btn-sm ${values.priceInput.kind === "price" ? "btn-primary" : "btn-ghost"}`}
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
                className={`join-item btn btn-sm ${values.priceInput.kind === "sqrtPriceX96" ? "btn-primary" : "btn-ghost"}`}
                onClick={() =>
                  setValues((current) => ({
                    ...current,
                    priceInput: { kind: "sqrtPriceX96", value: current.priceInput.value },
                  }))
                }
              >
                sqrtPriceX96
              </button>
            </div>
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
                Pool creation must be re-checked against the current chain state immediately before signing. A stale
                price or expired deadline must be rejected.
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
            <span className="label-text">I understand the price will be checked again at execution time.</span>
          </label>

          {!config ? (
            <p className="text-sm text-warning">
              Pool factory deployment is not configured for this environment. Protected submission is unavailable.
            </p>
          ) : null}
          {config && !chainReady ? (
            <p className="text-sm text-error">Switch to the configured deployment network before submitting.</p>
          ) : null}
          {!isConnected ? (
            <p className="text-sm text-base-content/60">Connect a wallet to prepare a protected transaction.</p>
          ) : null}
          <Button type="button" fullWidth loading={isPending} disabled={!canSubmit} onClick={() => void submit()}>
            {isPending ? "Confirming in wallet…" : "Create pool"}
          </Button>
        </CardBody>
      </Card>
    </div>
  )
}

function useStateWithFormDefaults() {
  const [values, setValues] = useState<PoolCreationFormValues>({
    token0: "",
    token1: "",
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

function decimalToSqrtPriceX96(value: string): bigint {
  const [whole = "0", fraction = ""] = value.split(".")
  const scale = 10n ** 18n
  const normalizedFraction = fraction.padEnd(18, "0").slice(0, 18)
  const scaledPrice = BigInt(whole) * scale + BigInt(normalizedFraction)
  return (integerSqrt(scaledPrice) * Q96) / 10n ** 9n
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
