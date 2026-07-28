/**
 * AetherDEX Keeper Relayer — Phase 2/3 (MEV Tier-B private submission)
 *
 * Funds + signs keeper transactions for unattended TP/SL (auto-recenter later)
 * execution. Safe-by-default submission policy:
 *
 *   1. PRIVATE_TX_RELAY_URL set (https only)  → sign locally, POST the signed
 *      raw tx to the relay via eth_sendRawTransaction (MEV Tier-B: protected,
 *      private submission — never broadcast to the public mempool).
 *   2. else KEEPER_ALLOW_PUBLIC_SUBMISSION="true" → explicit opt-in public send
 *      via the wallet client.
 *   3. otherwise → "submission-disabled": the keeper stays EVALUATION-ONLY and
 *      no transaction is built or sent.
 *
 * Security: the private key (KEEPER_PRIVATE_KEY secret) is loaded into a viem
 * account and NEVER logged; signed raw transactions are never logged either.
 * All env reads are defensive — malformed values degrade to the safe default.
 */

import {
  createPublicClient,
  createWalletClient,
  encodeFunctionData,
  http,
  isAddress,
  parseAbi,
  parseEther,
  parseGwei,
} from "viem"
import { privateKeyToAccount } from "viem/accounts"
import { parseChainId } from "./chain-id"
import { parsePositiveFloat } from "./safety-config"

// ─── Env + config ───────────────────────────────────────────────────────────

/** Keeper-related env vars. All optional — missing/malformed values keep the
 *  relayer evaluation-only (safe default). Secrets are set via
 *  `wrangler secret put` (KEEPER_PRIVATE_KEY, KEEPER_RPC_URL). */
export interface KeeperSignerEnv {
  readonly CHAIN_ID?: string
  readonly KEEPER_PRIVATE_KEY?: string
  readonly KEEPER_RPC_URL?: string
  readonly KEEPER_MAX_GAS_PRICE_GWEI?: string
  readonly KEEPER_MIN_BALANCE_ETH?: string
  readonly KEEPER_ALLOW_PUBLIC_SUBMISSION?: string
  readonly PRIVATE_TX_RELAY_URL?: string
  readonly TPSL_ADDRESS?: string
  readonly AETHER_TPSL_ADDRESS?: string
}

export interface KeeperSignerConfig {
  /** Chain the keeper operates on; null keeps the relayer evaluation-only. */
  readonly chainId: number | null
  /** Normalized 0x-prefixed 32-byte hex key, or null when absent/invalid. */
  readonly privateKey: `0x${string}` | null
  /** RPC endpoint transactions are sent through (signing always happens locally). */
  readonly rpcUrl: string | null
  /** Optional gas price ceiling in gwei; null = no ceiling. */
  readonly maxGasPriceGwei: number | null
  /** Gas-funding budget guard (default 0.05 ETH). */
  readonly minBalanceWei: bigint
  /** https-only relay endpoint; null when unset or non-https. */
  readonly privateRelayUrl: string | null
  /** Public-mempool opt-in. Defaults to false (never on by default). */
  readonly allowPublicSubmission: boolean
  /** Resolved AetherTPSL contract address, or null. */
  readonly tpslAddress: `0x${string}` | null
}

export const DEFAULT_MIN_BALANCE_ETH = "0.05"

const parseHexPrivateKey = (raw: string | undefined): `0x${string}` | null => {
  if (raw === undefined) return null
  const trimmed = raw.trim()
  const candidate = trimmed.startsWith("0x") ? trimmed.slice(2) : trimmed
  return /^[0-9a-fA-F]{64}$/.test(candidate) ? `0x${candidate.toLowerCase()}` : null
}

/** Only https relays are accepted — private submission over cleartext is never allowed. */
export const parseRelayUrl = (raw: string | undefined): string | null => {
  if (raw === undefined) return null
  const trimmed = raw.trim()
  if (trimmed.length === 0) return null
  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    return null
  }
  return parsed.protocol === "https:" ? trimmed : null
}

const parseAddress = (raw: string | undefined): `0x${string}` | null => {
  if (raw === undefined) return null
  const trimmed = raw.trim()
  return isAddress(trimmed) ? (trimmed as `0x${string}`) : null
}

const isFlagEnabled = (raw: string | undefined): boolean => raw?.trim().toLowerCase() === "true"

const parseMinBalanceWei = (raw: string | undefined): bigint => {
  if (parsePositiveFloat(raw) === undefined) return parseEther(DEFAULT_MIN_BALANCE_ETH)
  try {
    return parseEther((raw as string).trim())
  } catch {
    return parseEther(DEFAULT_MIN_BALANCE_ETH)
  }
}

/** Resolves the AetherTPSL address (TPSL_ADDRESS wins, then AETHER_TPSL_ADDRESS). */
export const resolveTpslAddress = (env: KeeperSignerEnv): `0x${string}` | null =>
  parseAddress(env.TPSL_ADDRESS) ?? parseAddress(env.AETHER_TPSL_ADDRESS)

export function readKeeperSignerConfig(env: KeeperSignerEnv): KeeperSignerConfig {
  return {
    chainId: parseChainId(env.CHAIN_ID),
    privateKey: parseHexPrivateKey(env.KEEPER_PRIVATE_KEY),
    rpcUrl: env.KEEPER_RPC_URL?.trim() ? env.KEEPER_RPC_URL.trim() : null,
    maxGasPriceGwei: parsePositiveFloat(env.KEEPER_MAX_GAS_PRICE_GWEI) ?? null,
    minBalanceWei: parseMinBalanceWei(env.KEEPER_MIN_BALANCE_ETH),
    privateRelayUrl: parseRelayUrl(env.PRIVATE_TX_RELAY_URL),
    allowPublicSubmission: isFlagEnabled(env.KEEPER_ALLOW_PUBLIC_SUBMISSION),
    tpslAddress: resolveTpslAddress(env),
  }
}

// ─── Typed errors ───────────────────────────────────────────────────────────

/** Transient RPC failure (balance/nonce/gas reads or public submission). Safe to retry. */
export class KeeperRpcError extends Error {
  readonly _tag = "KeeperRpcError"
}

/** Keeper wallet cannot fund the gas budget. Deterministic — retrying immediately is pointless. */
export class InsufficientKeeperBalanceError extends Error {
  readonly _tag = "InsufficientKeeperBalanceError"
  constructor(
    readonly address: string,
    readonly balanceWei: bigint,
    readonly minimumWei: bigint,
  ) {
    super(`Keeper balance ${balanceWei} wei is below the ${minimumWei} wei funding floor`)
  }
}

/** Current gas price exceeds the configured ceiling. Deterministic while the ceiling holds. */
export class GasPriceExceededError extends Error {
  readonly _tag = "GasPriceExceededError"
  constructor(
    readonly gasPriceWei: bigint,
    readonly maxGasPriceWei: bigint,
  ) {
    super(`Gas price ${gasPriceWei} wei exceeds the ${maxGasPriceWei} wei ceiling`)
  }
}

/** Requested chain does not match the keeper's configured chain. Deterministic misconfiguration. */
export class KeeperChainMismatchError extends Error {
  readonly _tag = "KeeperChainMismatchError"
  constructor(
    readonly expectedChainId: number,
    readonly actualChainId: number,
    readonly address: string,
  ) {
    super(`Keeper is configured for chain ${expectedChainId} but received chain ${actualChainId}`)
  }
}

/** Private relay rejection or transport failure. `retryable` marks 5xx / network faults. */
export class KeeperRelayError extends Error {
  readonly _tag = "KeeperRelayError"
  constructor(
    message: string,
    readonly retryable: boolean,
  ) {
    super(message)
  }
}

/** True for errors where a queue retry can plausibly succeed (network/RPC/5xx). */
export const isTransientKeeperError = (error: unknown): boolean => {
  if (error instanceof KeeperRpcError) return true
  if (error instanceof KeeperRelayError) return error.retryable
  return false
}

// ─── Submission types ───────────────────────────────────────────────────────

export type SubmissionChannel = "private-relay" | "public" | "evaluation-only"

export type SubmissionResult =
  | { readonly kind: "submitted"; readonly channel: SubmissionChannel; readonly txHash: `0x${string}` }
  | { readonly kind: "submission-disabled"; readonly reason: string }

export interface SendTransactionInput {
  readonly to: `0x${string}`
  readonly data: `0x${string}`
  readonly value?: bigint
  /** Must match the keeper's configured chainId when both are set. */
  readonly chainId?: number
  /** Optional gas limit override (otherwise estimated via the RPC). */
  readonly gasLimit?: bigint
}

export interface KeeperSigner {
  /** Signing address, or null when no key/RPC is configured. */
  readonly address: `0x${string}` | null
  /** Which channel this signer will use; "evaluation-only" never submits. */
  readonly channel: SubmissionChannel
  sendTransaction(input: SendTransactionInput): Promise<SubmissionResult>
}

/** Minimal surface of the viem public client the relayer drives (test seam). */
interface KeeperChainClient {
  getBalance(args: { address: `0x${string}` }): Promise<bigint>
  getTransactionCount(args: { address: `0x${string}` }): Promise<number>
  estimateGas(args: {
    account: { address: `0x${string}` }
    to: `0x${string}`
    data: `0x${string}`
    value?: bigint
  }): Promise<bigint>
  getGasPrice(): Promise<bigint>
}

// Minimal viem wallet surface. account is deliberately NOT a per-call arg: a
// non-LocalAccount value would silently reroute the send to a JSON-RPC
// "unlocked account" instead of local signing — a keeper security footgun.
interface KeeperSubmitClient {
  sendTransaction(args: {
    chain: null
    to: `0x${string}`
    data: `0x${string}`
    value?: bigint
    nonce: number
    gas: bigint
    gasPrice: bigint
  }): Promise<`0x${string}`>
}

export interface KeeperSignerDeps {
  readonly publicClient?: KeeperChainClient
  readonly walletClient?: KeeperSubmitClient
  readonly fetchFn?: typeof fetch
}

// ─── AetherTPSL encoding ────────────────────────────────────────────────────

export const AETHER_TPSL_ABI = parseAbi([
  "function executeOrder(uint256 orderId, bytes hookData) returns (bool executed)",
])

/**
 * Encode an AetherTPSL.executeOrder calldata payload. hookData defaults to "0x":
 * AetherTPSL.executeOrder re-verifies the dual trigger on-chain from the order's
 * own stored parameters before moving funds, so no hook payload is required.
 */
export function encodeExecuteOrder(orderId: number | bigint, hookData: `0x${string}` = "0x"): `0x${string}` {
  const id = BigInt(orderId)
  if (id < 0n) throw new RangeError(`orderId must be non-negative, got ${orderId}`)
  return encodeFunctionData({ abi: AETHER_TPSL_ABI, functionName: "executeOrder", args: [id, hookData] })
}

// ─── Authorization policy helpers (pure) ────────────────────────────────────

export interface TpSlExecutableLike {
  readonly status: string
  /** Epoch milliseconds, matching tp_sl_orders.deadline. */
  readonly deadline: number
  readonly chainId: number
  readonly amountIn?: string
}

export interface TpSlExecutionPolicy {
  readonly expectedChainId: number
  /** Optional cap on the input amount the keeper is allowed to execute. */
  readonly maxAmountIn?: bigint
}

/**
 * Pure pre-execution authorization gate: status must be pending, the deadline
 * must be in the future, the order's chain must match, and — when the policy
 * carries a cap — the input amount must not exceed it.
 */
export function canExecuteTpSlOrder(
  order: TpSlExecutableLike,
  policy: TpSlExecutionPolicy,
  now: number,
): boolean {
  if (order.status !== "pending") return false
  if (!Number.isFinite(order.deadline) || !Number.isFinite(now) || order.deadline <= now) return false
  if (!Number.isInteger(order.chainId) || !Number.isInteger(policy.expectedChainId)) return false
  if (order.chainId !== policy.expectedChainId) return false
  if (policy.maxAmountIn !== undefined) {
    let amountIn: bigint
    try {
      amountIn = BigInt(order.amountIn ?? "")
    } catch {
      return false
    }
    if (amountIn > policy.maxAmountIn) return false
  }
  return true
}

export interface RecenterPolicyLike {
  readonly isActive: boolean | number
}

/** Pure authorization gate for auto-recenter: only active policies may execute. */
export function canExecuteRecenter(policy: RecenterPolicyLike): boolean {
  return policy.isActive === true || policy.isActive === 1
}

// ─── Signer factory ─────────────────────────────────────────────────────────

const TX_HASH_PATTERN = /^0x[0-9a-fA-F]{64}$/

export function createKeeperSigner(config: KeeperSignerConfig, deps: KeeperSignerDeps = {}): KeeperSigner {
  const fetchImpl = deps.fetchFn ?? fetch

  const disabled = (address: `0x${string}` | null, reason: string): KeeperSigner => ({
    address,
    channel: "evaluation-only",
    sendTransaction: () => Promise.resolve({ kind: "submission-disabled", reason }),
  })

  if (config.privateKey === null) {
    return disabled(null, "KEEPER_PRIVATE_KEY not configured — evaluation-only")
  }
  if (config.rpcUrl === null) {
    return disabled(null, "KEEPER_RPC_URL not configured — evaluation-only")
  }
  if (config.chainId === null) {
    return disabled(null, "CHAIN_ID not configured — cannot sign chain-scoped transactions")
  }

  const account = privateKeyToAccount(config.privateKey)
  const chainId = config.chainId

  if (config.privateRelayUrl === null && !config.allowPublicSubmission) {
    return disabled(
      account.address,
      "No PRIVATE_TX_RELAY_URL configured and KEEPER_ALLOW_PUBLIC_SUBMISSION is not 'true' — safe evaluation-only default",
    )
  }

  const transport = http(config.rpcUrl)
  const publicClient: KeeperChainClient = (deps.publicClient ?? createPublicClient({ transport })) as KeeperChainClient

  const preflight = async (
    input: SendTransactionInput,
  ): Promise<{ nonce: number; gas: bigint; gasPrice: bigint }> => {
    if (input.chainId !== undefined && input.chainId !== chainId) {
      throw new KeeperChainMismatchError(chainId, input.chainId, account.address)
    }
    let nonce: number
    let balance: bigint
    let gas: bigint
    let gasPrice: bigint
    try {
      nonce = await publicClient.getTransactionCount({ address: account.address })
      balance = await publicClient.getBalance({ address: account.address })
      gasPrice = await publicClient.getGasPrice()
      gas =
        input.gasLimit ??
        (await publicClient.estimateGas({
          account: { address: account.address },
          to: input.to,
          data: input.data,
          ...(input.value !== undefined ? { value: input.value } : {}),
        }))
    } catch (error) {
      if (error instanceof KeeperChainMismatchError) throw error
      throw new KeeperRpcError(`Keeper preflight RPC failed: ${String(error)}`)
    }
    if (balance < config.minBalanceWei) {
      throw new InsufficientKeeperBalanceError(account.address, balance, config.minBalanceWei)
    }
    if (config.maxGasPriceGwei !== null) {
      const ceiling = parseGwei(String(config.maxGasPriceGwei))
      if (gasPrice > ceiling) throw new GasPriceExceededError(gasPrice, ceiling)
    }
    return { nonce, gas, gasPrice }
  }

  if (config.privateRelayUrl !== null) {
    const relayUrl = config.privateRelayUrl
    return {
      address: account.address,
      channel: "private-relay",
      sendTransaction: async (input: SendTransactionInput): Promise<SubmissionResult> => {
        const { nonce, gas, gasPrice } = await preflight(input)

        let signed: `0x${string}`
        try {
          signed = await account.signTransaction({
            chainId,
            to: input.to,
            data: input.data,
            ...(input.value !== undefined ? { value: input.value } : {}),
            nonce,
            gas,
            gasPrice,
          })
        } catch (error) {
          throw new KeeperRpcError(`Keeper tx signing failed: ${String(error)}`)
        }

        // Defense in depth: parseRelayUrl already enforces https at config time.
        let relay: URL
        try {
          relay = new URL(relayUrl)
        } catch {
          throw new KeeperRelayError("PRIVATE_TX_RELAY_URL is invalid", false)
        }
        if (relay.protocol !== "https:") {
          throw new KeeperRelayError("PRIVATE_TX_RELAY_URL must use https (MEV Tier-B)", false)
        }

        let response: Response
        try {
          response = await fetchImpl(relayUrl, {
            method: "POST",
            headers: { "content-type": "application/json" },
            // NOTE: the signed raw tx is deliberately never logged.
            body: JSON.stringify({
              jsonrpc: "2.0",
              id: 1,
              method: "eth_sendRawTransaction",
              params: [signed],
            }),
          })
        } catch (error) {
          throw new KeeperRelayError(`Private relay request failed: ${String(error)}`, true)
        }

        if (!response.ok) {
          throw new KeeperRelayError(
            `Private relay returned HTTP ${response.status}`,
            response.status >= 500,
          )
        }

        let payload: Record<string, unknown> | null = null
        try {
          const body: unknown = await response.json()
          if (typeof body === "object" && body !== null) payload = body as Record<string, unknown>
        } catch {
          payload = null
        }
        if (payload === null) throw new KeeperRelayError("Private relay returned a non-JSON response", false)

        const errorField = payload.error
        if (errorField !== undefined && errorField !== null) {
          const message =
            typeof errorField === "object"
              ? String((errorField as { message?: unknown }).message ?? "rejected")
              : String(errorField)
          throw new KeeperRelayError(`Private relay rejected transaction: ${message}`, false)
        }

        if (typeof payload.result !== "string" || !TX_HASH_PATTERN.test(payload.result)) {
          throw new KeeperRelayError("Private relay response is missing a valid transaction hash", false)
        }

        return { kind: "submitted", channel: "private-relay", txHash: payload.result as `0x${string}` }
      },
    }
  }

  // Explicit public-submission opt-in.
  const walletClient: KeeperSubmitClient = (deps.walletClient ??
    createWalletClient({
      account,
      transport,
    })) as unknown as KeeperSubmitClient

  return {
    address: account.address,
    channel: "public",
    sendTransaction: async (input: SendTransactionInput): Promise<SubmissionResult> => {
      const { nonce, gas, gasPrice } = await preflight(input)
      let txHash: `0x${string}`
      try {
        txHash = await walletClient.sendTransaction({
          // chain: null → send on the wallet client's default chain; the target
          // chain was already validated against the config in preflight.
          chain: null,
          to: input.to,
          data: input.data,
          ...(input.value !== undefined ? { value: input.value } : {}),
          nonce,
          gas,
          gasPrice,
        })
      } catch (error) {
        throw new KeeperRpcError(`Public submission failed: ${String(error)}`)
      }
      return { kind: "submitted", channel: "public", txHash }
    },
  }
}
