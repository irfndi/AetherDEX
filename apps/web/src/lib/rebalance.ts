export type RebalancePosition = {
  readonly positionId: string
  readonly poolId: string
  readonly pair: string
  readonly token0: string
  readonly token1: string
  readonly currentLowerTick: number
  readonly currentUpperTick: number
  readonly tickSpacing: number
  readonly liquidity: string
}

export type RebalanceFormValues = {
  readonly lowerTick: string
  readonly upperTick: string
  readonly slippage: string
  readonly deadline: string
}

export type RebalanceField = keyof RebalanceFormValues
export type RebalanceErrors = Partial<Record<RebalanceField, string>>

export type RebalanceValidation = {
  readonly valid: boolean
  readonly errors: RebalanceErrors
}

export type RebalanceStep =
  | { readonly kind: "close"; readonly description: string }
  | { readonly kind: "collect"; readonly description: string }
  | { readonly kind: "remint"; readonly description: string }

export type RebalanceIntent = {
  readonly kind: "aetherdex.rebalance"
  readonly position: RebalancePosition
  readonly newRange: {
    readonly lowerTick: number
    readonly upperTick: number
  }
  readonly slippageBps: number
  readonly deadlineSeconds: number
  readonly steps: readonly RebalanceStep[]
  readonly execution: {
    readonly status: "unavailable"
    readonly reason: "manager-router-not-configured"
  }
}

const MAX_SLIPPAGE_BPS = 500
const MIN_DEADLINE_SECONDS = 60
const MAX_DEADLINE_SECONDS = 86_400

function parseInteger(value: string): number | null {
  if (!/^-?\d+$/.test(value.trim())) return null
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) ? parsed : null
}

function parseDecimal(value: string): number | null {
  if (!/^\d+(\.\d+)?$/.test(value.trim())) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

export function validateRebalanceForm(values: RebalanceFormValues, tickSpacing: number): RebalanceValidation {
  const errors: RebalanceErrors = {}
  const lowerTick = parseInteger(values.lowerTick)
  const upperTick = parseInteger(values.upperTick)
  const slippage = parseDecimal(values.slippage)
  const deadline = parseInteger(values.deadline)

  if (!Number.isSafeInteger(tickSpacing) || tickSpacing <= 0) {
    errors.lowerTick = "This pool has no valid tick spacing."
    errors.upperTick = "This pool has no valid tick spacing."
  } else {
    if (lowerTick === null) errors.lowerTick = "Enter a whole-number lower tick."
    if (upperTick === null) errors.upperTick = "Enter a whole-number upper tick."
    if (lowerTick !== null && lowerTick % tickSpacing !== 0) errors.lowerTick = `Use a multiple of ${tickSpacing}.`
    if (upperTick !== null && upperTick % tickSpacing !== 0) errors.upperTick = `Use a multiple of ${tickSpacing}.`
    if (lowerTick !== null && upperTick !== null && lowerTick >= upperTick) {
      errors.upperTick = "Upper tick must be greater than lower tick."
    }
  }

  if (slippage === null || slippage < 0 || slippage > MAX_SLIPPAGE_BPS / 100) {
    errors.slippage = "Use a value from 0% to 5%."
  }
  if (deadline === null || deadline < MIN_DEADLINE_SECONDS || deadline > MAX_DEADLINE_SECONDS) {
    errors.deadline = "Use a deadline between 1 minute and 24 hours."
  }

  return { valid: Object.keys(errors).length === 0, errors }
}

export function buildRebalanceIntent(
  position: RebalancePosition,
  values: RebalanceFormValues,
): RebalanceIntent | null {
  const validation = validateRebalanceForm(values, position.tickSpacing)
  if (!validation.valid) return null

  return {
    kind: "aetherdex.rebalance",
    position,
    newRange: {
      lowerTick: Number(values.lowerTick),
      upperTick: Number(values.upperTick),
    },
    slippageBps: Math.round(Number(values.slippage) * 100),
    deadlineSeconds: Number(values.deadline),
    steps: [
      { kind: "close", description: "Close the selected position." },
      { kind: "collect", description: "Collect tokens and fees from the closed position." },
      { kind: "remint", description: "Re-mint the position in the new tick range." },
    ],
    execution: {
      status: "unavailable",
      reason: "manager-router-not-configured",
    },
  }
}
