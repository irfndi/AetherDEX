/**
 * AetherDEX Phase 4 protocol entry fee — client-side fee transparency helper.
 *
 * Mirrors `apps/api/src/lib/protocol-fee.ts` and the on-chain invariant in
 * `packages/contracts/src/router/AetherRouter.sol`: `PROTOCOL_FEE_BPS = 10`
 * (0.1%) is an IMMUTABLE constant with no admin setter, charged on liquidity
 * deposits ONLY (`addLiquidity` / `addLiquiditySingleSided`, on the gross
 * input pulled from the user). Swaps, `removeLiquidity`, rebalance, and TP/SL
 * execution stay protocol-fee-free, and LP pool swap fees accrue to LPs
 * separately.
 *
 * Amount semantics any deposit integration must honor:
 *   - the router pulls the GROSS approved amount and splits off the fee itself,
 *     so calldata encodes gross amounts (never pre-deduct);
 *   - estimates, expected outputs and the "what actually gets deposited"
 *     number shown to the user derive from the NET `amountAfterFee`.
 *
 * The bigint path reproduces the router's integer division exactly
 * (`fee = gross * 10 / 10_000`, floored). The `number` display path is for
 * UI estimates on human-readable decimals only — never use it to size
 * on-chain amounts.
 */
import { formatUnits } from "viem"
import { API_URL, isRecord } from "./api"

/** Flat protocol entry fee, 10 bps = 0.1% — mirrors `AetherRouter.PROTOCOL_FEE_BPS`. */
export const PROTOCOL_FEE_BPS = 10 as const

/** Fee as a percent value (0.1 = one tenth of a percent). */
export const PROTOCOL_FEE_PERCENT = 0.1 as const

/** Human-readable fee label for UIs (`"0.1%"`). */
export const PROTOCOL_FEE_PERCENT_LABEL = "0.1%" as const

/** Operations the router charges the entry fee on. Everything else is fee-free. */
export const PROTOCOL_FEE_CHARGED_ON = "liquidity_deposits" as const

const BPS_DENOMINATOR = 10_000
const BPS_DENOMINATOR_BIGINT = 10_000n
const FEE_BPS_BIGINT = BigInt(PROTOCOL_FEE_BPS)

export interface ProtocolFeeComputed<Amount extends bigint | number> {
  /** Fee deducted on the gross input (`gross * 10 / 10_000`, floored). */
  readonly fee: Amount
  /** Amount available to the deposit after the treasury transfer: `gross - fee`. */
  readonly amountAfterFee: Amount
}

/**
 * Compute the 10 bps protocol entry fee on a gross deposit amount in base
 * units. Integer division matches `AetherRouter._chargeEntryFee` exactly
 * (fee floored, remainder = gross - fee, sub-bps inputs floor to zero).
 *
 * Use this for anything derived from or compared against on-chain amounts.
 *
 * @throws {RangeError} when the amount is negative.
 */
export function computeProtocolFee(amount: bigint): ProtocolFeeComputed<bigint> {
  if (amount < 0n) throw new RangeError("Protocol fee amount must be non-negative")
  const fee = (amount * FEE_BPS_BIGINT) / BPS_DENOMINATOR_BIGINT
  return { fee, amountAfterFee: amount - fee }
}

/**
 * Display-only protocol fee estimate for a human-readable decimal amount
 * (e.g. "12.5" tokens entered in a form field). Results are rounded to 12
 * significant digits to strip binary floating-point dust; they are NOT
 * on-chain exact — derive on-chain sizes via {@link computeProtocolFee} on
 * base units.
 *
 * @throws {RangeError} when the amount is non-finite or negative.
 */
export function computeProtocolFeeDisplay(amount: number): ProtocolFeeComputed<number> {
  if (!Number.isFinite(amount) || amount < 0) {
    throw new RangeError("Protocol fee amount must be a finite non-negative number")
  }
  return {
    fee: roundForDisplay((amount * PROTOCOL_FEE_BPS) / BPS_DENOMINATOR),
    amountAfterFee: roundForDisplay(amount - (amount * PROTOCOL_FEE_BPS) / BPS_DENOMINATOR),
  }
}

/**
 * Format a base-unit amount into a trimmed decimal string for fee display
 * (e.g. `12_500_000_000_000_000n` at 18 decimals → `"0.0125"`). Returns `"0"`
 * for a zero fee (sub-bps deposits).
 */
export function formatProtocolFeeAmount(rawAmount: bigint, decimals: number): string {
  const formatted = formatUnits(rawAmount, decimals)
  if (formatted === "0") return "0"
  const trimmed = formatted.replace(/\.?0+$/, "")
  return trimmed.endsWith(".") ? `${trimmed}0` : trimmed
}

/**
 * Compact USD display for fee estimates, matching the existing `formatUsd`
 * style used on pool pages (`$1.23K`, `$12.34`, `$2.00M`). Values below one
 * cent render as `"< $0.01"`.
 */
export function formatProtocolFeeUsd(usdValue: number): string {
  if (!Number.isFinite(usdValue) || usdValue < 0) return "—"
  if (usdValue >= 1_000_000) return `$${(usdValue / 1_000_000).toFixed(2)}M`
  if (usdValue >= 1_000) return `$${(usdValue / 1_000).toFixed(2)}K`
  if (usdValue >= 1) return `$${usdValue.toFixed(2)}`
  if (usdValue >= 0.01) return `$${usdValue.toFixed(2)}`
  if (usdValue > 0) return "< $0.01"
  return "$0.00"
}

/** Router deposit entry points that incur the protocol entry fee (API contract). */
export const DEPOSIT_ESTIMATE_MODES = ["add_liquidity", "add_liquidity_single_sided"] as const
export type DepositEstimateMode = (typeof DEPOSIT_ESTIMATE_MODES)[number]

/** One gross deposit input line for {@link fetchDepositEstimate}. */
export interface DepositEstimateAmountInput {
  readonly token?: string | undefined
  readonly grossAmount: bigint
}

/** Per-token fee line returned by `POST /api/v1/liquidity/deposit-estimate`. */
export interface ProtocolFeeAmountEntry {
  readonly token: string | null
  readonly grossAmount: string
  readonly protocolFeeAmount: string
  readonly amountAfterProtocolFee: string
}

/** Rate triplet + per-token lines in the API `protocolFee` response object. */
export interface ProtocolFeeResponseBreakdown {
  readonly protocolFeeBps: number
  readonly protocolFeePercent: number
  readonly protocolFeePercentLabel: string
  readonly chargedOn: string
  readonly chargedHere: boolean
  readonly amounts: readonly ProtocolFeeAmountEntry[]
}

export interface DepositEstimateResponse {
  readonly mode: DepositEstimateMode
  readonly protocolFee: ProtocolFeeResponseBreakdown
}

export interface FetchDepositEstimateOptions {
  readonly signal?: AbortSignal | undefined
}

/**
 * Fetch the server-computed deposit fee breakdown from
 * `POST {API_URL}/liquidity/deposit-estimate`. The endpoint is pure compute
 * over the immutable on-chain constant, so the client-side
 * {@link computeProtocolFee} above is an equally valid source — use this when
 * the UI wants the API-attested breakdown (e.g. to surface the server's
 * per-token lines verbatim).
 *
 * @throws {Error} on network failure, non-2xx status, or an unexpected payload.
 */
export async function fetchDepositEstimate(
  mode: DepositEstimateMode,
  amounts: readonly DepositEstimateAmountInput[],
  options: FetchDepositEstimateOptions = {},
): Promise<DepositEstimateResponse> {
  const body = {
    mode,
    amounts: amounts.map((amount) =>
      amount.token === undefined
        ? { grossAmount: amount.grossAmount.toString() }
        : { token: amount.token, grossAmount: amount.grossAmount.toString() },
    ),
  }
  const res = await fetch(`${API_URL}/liquidity/deposit-estimate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: options.signal ?? null,
  })
  if (!res.ok) throw new Error(`Deposit estimate failed: HTTP ${res.status}`)
  const json: unknown = await res.json()
  return parseDepositEstimateResponse(json)
}

function parseDepositEstimateResponse(json: unknown): DepositEstimateResponse {
  if (!isRecord(json)) throw new Error("Unexpected deposit estimate response")
  if (
    typeof json.mode !== "string" ||
    !(DEPOSIT_ESTIMATE_MODES as readonly string[]).includes(json.mode)
  ) {
    throw new Error("Deposit estimate response is missing a valid mode")
  }
  const breakdown = json.protocolFee
  if (!isRecord(breakdown) || typeof breakdown.chargedHere !== "boolean" || !Array.isArray(breakdown.amounts)) {
    throw new Error("Deposit estimate response is missing the protocol fee breakdown")
  }
  const amounts: ProtocolFeeAmountEntry[] = []
  for (const entry of breakdown.amounts as unknown[]) {
    if (!isRecord(entry)) throw new Error("Deposit estimate fee line is malformed")
    if (
      typeof entry.grossAmount !== "string" ||
      typeof entry.protocolFeeAmount !== "string" ||
      typeof entry.amountAfterProtocolFee !== "string"
    ) {
      throw new Error("Deposit estimate fee line is missing amounts")
    }
    amounts.push({
      token: typeof entry.token === "string" ? entry.token : null,
      grossAmount: entry.grossAmount,
      protocolFeeAmount: entry.protocolFeeAmount,
      amountAfterProtocolFee: entry.amountAfterProtocolFee,
    })
  }
  return {
    mode: json.mode as DepositEstimateMode,
    protocolFee: {
      protocolFeeBps: typeof breakdown.protocolFeeBps === "number" ? breakdown.protocolFeeBps : PROTOCOL_FEE_BPS,
      protocolFeePercent:
        typeof breakdown.protocolFeePercent === "number" ? breakdown.protocolFeePercent : PROTOCOL_FEE_PERCENT,
      protocolFeePercentLabel:
        typeof breakdown.protocolFeePercentLabel === "string"
          ? breakdown.protocolFeePercentLabel
          : PROTOCOL_FEE_PERCENT_LABEL,
      chargedOn:
        typeof breakdown.chargedOn === "string" ? breakdown.chargedOn : PROTOCOL_FEE_CHARGED_ON,
      chargedHere: breakdown.chargedHere,
      amounts,
    },
  }
}

function roundForDisplay(value: number): number {
  if (value === 0) return 0
  return Number.parseFloat(value.toPrecision(12))
}
