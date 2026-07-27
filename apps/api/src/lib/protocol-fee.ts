/**
 * AetherDEX Phase 4 protocol entry fee — shared fee transparency helper.
 *
 * Mirrors the on-chain invariant in `packages/contracts/src/router/AetherRouter.sol`:
 * `PROTOCOL_FEE_BPS = 10` (0.1%) is an IMMUTABLE constant with NO admin setter —
 * it is charged on liquidity deposits ONLY (`addLiquidity` / `addLiquiditySingleSided`,
 * on each token pulled from the user). Swaps, `removeLiquidity`, rebalance, and
 * TP/SL execution remain protocol-fee-free, and the hook charges no swap fees
 * (oracle-only), so this is the single entry fee.
 *
 * ── Calldata / amount semantics any deposit builder MUST honor ─────────────
 * The router pulls the GROSS amount the user approved, deducts the entry fee to
 * the treasury (`fee = gross * 10 / 10000`, integer division), and runs the
 * swap/mint on the NET remainder. Therefore:
 *   - router calldata args encode GROSS user-approved amounts (the router itself
 *     splits off the fee — never pre-deduct it in the calldata);
 *   - liquidity estimates, expected outputs, and slippage min-amount bounds are
 *     derived from NET amounts (`amountAfterProtocolFee`), because that is what
 *     the router actually deposits;
 *   - refunds (e.g. single-sided dust) are net of fee — the user gets back only
 *     what remains after the treasury transfer.
 * Sub-basis-point inputs: for `gross < 1000` the fee floors to 0 and the router
 * no-ops the transfer; the bigint math below reproduces that exactly. The
 * `number` overload is for UI display only — on-chain-relevant math uses bigint.
 *
 * Response JSON carries only additive keys (`protocolFee*`), so existing API
 * consumers keep working unchanged.
 */

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
  /** Fee deducted on the gross input (`gross * 10 / 10000`, floored). */
  readonly fee: Amount
  /** Amount available to the deposit operation after the treasury transfer. */
  readonly amountAfterFee: Amount
}

/**
 * Compute the 10 bps protocol entry fee on a gross deposit amount.
 *
 * The bigint overload uses integer division that matches `AetherRouter._chargeEntryFee`
 * exactly (fee floored, refund = gross - fee). The number overload floors the fee
 * for display purposes only — never use it to size on-chain amounts.
 *
 * @throws {RangeError} when the amount is negative or (number path) non-finite.
 */
export function computeProtocolFee(amount: bigint): ProtocolFeeComputed<bigint>
export function computeProtocolFee(amount: number): ProtocolFeeComputed<number>
export function computeProtocolFee(
  amount: bigint | number,
): ProtocolFeeComputed<bigint> | ProtocolFeeComputed<number> {
  if (typeof amount === "bigint") {
    if (amount < 0n) throw new RangeError("Protocol fee amount must be non-negative")
    const fee = (amount * FEE_BPS_BIGINT) / BPS_DENOMINATOR_BIGINT
    return { fee, amountAfterFee: amount - fee }
  }
  if (!Number.isFinite(amount) || amount < 0) {
    throw new RangeError("Protocol fee amount must be a finite non-negative number")
  }
  const fee = Math.floor((amount * PROTOCOL_FEE_BPS) / BPS_DENOMINATOR)
  return { fee, amountAfterFee: amount - fee }
}

/** Per-token fee line in a deposit fee breakdown (string-encoded for JSON). */
export interface ProtocolFeeAmountEntry {
  /** ERC-20 token the gross input was pulled in (`null` when unnamed). */
  readonly token: string | null
  /** Gross input amount the user approves / the router pulls. */
  readonly grossAmount: string
  /** Entry fee sent to the treasury: `floor(gross * 10 / 10000)`. */
  readonly protocolFeeAmount: string
  /** Net amount the router actually puts to work: `gross - fee`. */
  readonly amountAfterProtocolFee: string
}

/**
 * Additive fee-metadata object embedded in API responses. The rate triplet
 * (`protocolFeeBps` / `protocolFeePercent` / `protocolFeePercentLabel`) is
 * always present; `chargedHere` says whether THIS endpoint's operation incurs
 * the fee; `amounts` holds per-token lines when the gross input amounts are known.
 */
export interface ProtocolFeeBreakdown {
  readonly protocolFeeBps: typeof PROTOCOL_FEE_BPS
  readonly protocolFeePercent: typeof PROTOCOL_FEE_PERCENT
  readonly protocolFeePercentLabel: typeof PROTOCOL_FEE_PERCENT_LABEL
  readonly chargedOn: typeof PROTOCOL_FEE_CHARGED_ON
  /** `true` only for liquidity deposits (addLiquidity / addLiquiditySingleSided). */
  readonly chargedHere: boolean
  readonly amounts: readonly ProtocolFeeAmountEntry[]
}

/**
 * Fee breakdown for fee-free operations (swaps, removeLiquidity, rebalance,
 * TP/SL). Frozen + shared: the rate is immutable on-chain, so every zero-fee
 * endpoint returns the exact same object.
 */
export const ZERO_PROTOCOL_FEE_BREAKDOWN: ProtocolFeeBreakdown = Object.freeze({
  protocolFeeBps: PROTOCOL_FEE_BPS,
  protocolFeePercent: PROTOCOL_FEE_PERCENT,
  protocolFeePercentLabel: PROTOCOL_FEE_PERCENT_LABEL,
  chargedOn: PROTOCOL_FEE_CHARGED_ON,
  chargedHere: false,
  amounts: Object.freeze([]),
})

/** A deposit input line for breakdown construction (bigint = on-chain exact). */
export interface ProtocolFeeInput {
  readonly token?: string
  readonly grossAmount: bigint
}

/**
 * Build the `protocolFee` response object.
 *
 * @param charged `true` for deposit endpoints (router charges on gross pulled),
 *   `false` for fee-free operations — returns {@link ZERO_PROTOCOL_FEE_BREAKDOWN}.
 * @param inputs Gross deposit amounts per relevant token (only meaningful when charged).
 */
export function protocolFeeBreakdown(
  charged: boolean,
  inputs?: readonly ProtocolFeeInput[],
): ProtocolFeeBreakdown {
  if (!charged) return ZERO_PROTOCOL_FEE_BREAKDOWN
  const amounts: ProtocolFeeAmountEntry[] = (inputs ?? []).map((input) => {
    const { fee, amountAfterFee } = computeProtocolFee(input.grossAmount)
    return {
      token: input.token ?? null,
      grossAmount: input.grossAmount.toString(),
      protocolFeeAmount: fee.toString(),
      amountAfterProtocolFee: amountAfterFee.toString(),
    }
  })
  return { ...ZERO_PROTOCOL_FEE_BREAKDOWN, chargedHere: true, amounts }
}
