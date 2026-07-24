export const LIQUIDITY_SIDES = ["token0", "token1"] as const
export type LiquiditySide = (typeof LIQUIDITY_SIDES)[number]

export type LiquidityFormValues = {
  readonly tokenSide: LiquiditySide
  readonly amount: string
  readonly lowerTick: string
  readonly upperTick: string
  readonly slippage: string
  readonly deadline: string
}

export type LiquidityField = keyof LiquidityFormValues
export type LiquidityErrors = Partial<Record<LiquidityField, string>>

export type LiquidityTransactionRequest = {
  readonly kind: "aetherdex.addLiquidity"
  readonly poolId: string
  readonly tokenSide: LiquiditySide
  readonly amount: string
  readonly lowerTick: number
  readonly upperTick: number
  readonly slippageBps: number
  readonly deadlineSeconds: number
  readonly execution: {
    readonly status: "not-configured"
    readonly reason: "router-address-not-configured"
  }
}

export type LiquidityValidation = {
  readonly valid: boolean
  readonly errors: LiquidityErrors
}

const MIN_DEADLINE_SECONDS = 60
const MAX_DEADLINE_SECONDS = 86_400
const MAX_SLIPPAGE_PERCENT = 5

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

export function validateLiquidityForm(values: LiquidityFormValues, tickSpacing: number): LiquidityValidation {
  const errors: LiquidityErrors = {}
  const amount = parseDecimal(values.amount)
  const lowerTick = parseInteger(values.lowerTick)
  const upperTick = parseInteger(values.upperTick)
  const slippage = parseDecimal(values.slippage)
  const deadline = parseInteger(values.deadline)

  if (amount === null || amount <= 0) errors.amount = "Enter an amount greater than zero."
  if (lowerTick === null) errors.lowerTick = "Enter a whole-number lower tick."
  if (upperTick === null) errors.upperTick = "Enter a whole-number upper tick."
  if (lowerTick !== null && lowerTick % tickSpacing !== 0) errors.lowerTick = `Use a multiple of ${tickSpacing}.`
  if (upperTick !== null && upperTick % tickSpacing !== 0) errors.upperTick = `Use a multiple of ${tickSpacing}.`
  if (lowerTick !== null && upperTick !== null && lowerTick >= upperTick) {
    errors.upperTick = "Upper tick must be greater than lower tick."
  }
  if (slippage === null || slippage < 0 || slippage > MAX_SLIPPAGE_PERCENT) {
    errors.slippage = "Use a value from 0% to 5%."
  }
  if (deadline === null || deadline < MIN_DEADLINE_SECONDS || deadline > MAX_DEADLINE_SECONDS) {
    errors.deadline = "Use a deadline between 1 minute and 24 hours."
  }

  return { valid: Object.keys(errors).length === 0, errors }
}

export function buildLiquidityRequest(
  poolId: string,
  values: LiquidityFormValues,
  tickSpacing: number,
): LiquidityTransactionRequest | null {
  const validation = validateLiquidityForm(values, tickSpacing)
  if (!validation.valid) return null

  return {
    kind: "aetherdex.addLiquidity",
    poolId,
    tokenSide: values.tokenSide,
    amount: values.amount.trim(),
    lowerTick: Number(values.lowerTick),
    upperTick: Number(values.upperTick),
    slippageBps: Math.round(Number(values.slippage) * 100),
    deadlineSeconds: Number(values.deadline),
    execution: {
      status: "not-configured",
      reason: "router-address-not-configured",
    },
  }
}
