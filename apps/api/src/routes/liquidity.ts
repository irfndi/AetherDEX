/**
 * AetherDEX Liquidity HTTP endpoints — Phase 4 fee transparency
 *
 * POST /api/v1/liquidity/deposit-estimate — pure-compute entry-fee breakdown for
 * router liquidity deposits (addLiquidity / addLiquiditySingleSided). No chain
 * reads, no bindings: the fee is the immutable on-chain constant (10 bps), so
 * the breakdown is deterministic and safe to expose pre-deployment.
 *
 * Amount semantics (must match `AetherRouter`): the router pulls the GROSS
 * amount the user approved and deducts the 0.1% entry fee to the treasury
 * BEFORE swap/mint. Any future calldata builder for these operations must
 * therefore encode GROSS amounts in router args, while estimates and slippage
 * min-amount bounds are derived from the NET `amountAfterProtocolFee` values
 * this endpoint returns (refund dust is likewise net of fee). See
 * `src/lib/protocol-fee.ts` for the full contract reference.
 */

import { Hono } from "hono"
import { type ProtocolFeeInput, protocolFeeBreakdown } from "../lib/protocol-fee"

const liquidity = new Hono<{ Bindings: Env }>()

const ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/
const UINT_RE = /^\d+$/
const MAX_INPUTS = 8

/** Router deposit entry points that incur the protocol entry fee. */
const DEPOSIT_MODES = ["add_liquidity", "add_liquidity_single_sided"] as const
type DepositMode = (typeof DEPOSIT_MODES)[number]

const isDepositMode = (value: unknown): value is DepositMode =>
  typeof value === "string" && (DEPOSIT_MODES as readonly string[]).includes(value)

interface DepositEstimateBody {
  mode?: unknown
  amounts?: unknown
}

type ParsedInput = ProtocolFeeInput

const parseInputs = (raw: unknown, mode: DepositMode): { inputs?: readonly ParsedInput[]; error?: string } => {
  if (!Array.isArray(raw)) return { error: "amounts must be an array of { token?, grossAmount } entries" }
  if (raw.length < 1 || raw.length > MAX_INPUTS) {
    return { error: `amounts must contain 1 to ${MAX_INPUTS} entries` }
  }
  // addLiquiditySingleSided pulls exactly ONE input token (the router swaps half
  // internally), so only that single gross input is subject to the entry fee.
  if (mode === "add_liquidity_single_sided" && raw.length !== 1) {
    return { error: "add_liquidity_single_sided deposits take exactly one input amount" }
  }
  const inputs: ParsedInput[] = []
  for (const entry of raw) {
    if (typeof entry !== "object" || entry === null) {
      return { error: "Each amount entry must be an object with a grossAmount" }
    }
    const { token, grossAmount } = entry as { token?: unknown; grossAmount?: unknown }
    if (typeof grossAmount !== "string" || !UINT_RE.test(grossAmount)) {
      return { error: "grossAmount must be a non-negative integer string" }
    }
    let parsed: bigint
    try {
      parsed = BigInt(grossAmount)
    } catch {
      return { error: "grossAmount exceeds the supported integer range" }
    }
    if (parsed <= 0n) return { error: "grossAmount must be positive" }
    if (token !== undefined && (typeof token !== "string" || !ADDRESS_RE.test(token))) {
      return { error: "token must be a valid 0x-prefixed address when provided" }
    }
    inputs.push(token === undefined ? { grossAmount: parsed } : { token, grossAmount: parsed })
  }
  return { inputs }
}

liquidity.post("/deposit-estimate", async (c) => {
  const body = await c.req.json<DepositEstimateBody>().catch(() => null)
  if (!body || typeof body !== "object") {
    return c.json({ error: "JSON body with an amounts array is required" }, 400)
  }

  const mode = body.mode ?? "add_liquidity"
  if (!isDepositMode(mode)) {
    return c.json({ error: `mode must be one of: ${DEPOSIT_MODES.join(", ")}` }, 400)
  }

  const parsed = parseInputs(body.amounts, mode)
  if (parsed.error) return c.json({ error: parsed.error }, 400)
  const inputs = parsed.inputs as readonly ParsedInput[]

  return c.json({
    mode,
    protocolFee: protocolFeeBreakdown(true, inputs),
  })
})

export { liquidity }
