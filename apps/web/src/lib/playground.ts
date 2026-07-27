/**
 * Paper-LP playground simulation helpers (Phase 3).
 *
 * Everything here is pure, deterministic, and wallet-free: no transactions,
 * no chain state. Values are USD-denominated approximations of concentrated
 * liquidity positions — good enough to teach range mechanics, explicitly
 * labelled as paper trading in the UI.
 */

export const POSITION_STATUSES = ["below", "inside", "above"] as const
export type PositionStatus = (typeof POSITION_STATUSES)[number]

export type PlaygroundField = "amountUsdOrToken" | "currentPrice" | "lowerPrice" | "upperPrice" | "amount0" | "amount1"
export type PlaygroundErrors = Partial<Record<PlaygroundField, string>>

export type PlaygroundRangeInput = {
  readonly currentPrice: number
  readonly lowerPrice: number
  readonly upperPrice: number
}

export type PlaygroundValidation = {
  readonly valid: boolean
  readonly errors: PlaygroundErrors
}

/** Where `price` sits relative to a `[lowerPrice, upperPrice]` range. */
export function positionStatus(price: number, lowerPrice: number, upperPrice: number): PositionStatus {
  if (price <= lowerPrice) return "below"
  if (price >= upperPrice) return "above"
  return "inside"
}

export function validatePlaygroundRange(input: PlaygroundRangeInput): PlaygroundValidation {
  const errors: PlaygroundErrors = {}

  if (!Number.isFinite(input.currentPrice) || input.currentPrice <= 0) {
    errors.currentPrice = "Enter a price greater than zero."
  }
  if (!Number.isFinite(input.lowerPrice) || input.lowerPrice <= 0) {
    errors.lowerPrice = "Enter a price greater than zero."
  }
  if (!Number.isFinite(input.upperPrice) || input.upperPrice <= 0) {
    errors.upperPrice = "Enter a price greater than zero."
  }
  if (
    Number.isFinite(input.lowerPrice) &&
    Number.isFinite(input.upperPrice) &&
    input.lowerPrice > 0 &&
    input.upperPrice <= input.lowerPrice
  ) {
    errors.upperPrice = "Upper price must be greater than lower price."
  }

  return { valid: Object.keys(errors).length === 0, errors }
}

export type AllocatePositionInput = PlaygroundRangeInput & {
  /** Notional budget denominated in token1 (the quote / USD side). */
  readonly amountUsdOrToken: number
}

export type AllocationResult =
  | {
      readonly ok: true
      readonly side: PositionStatus
      readonly amount0: number
      readonly amount1: number
      readonly value0Usd: number
      readonly value1Usd: number
      readonly totalValueUsd: number
      /** token0 share of entry value, 0..1. */
      readonly token0Share: number
    }
  | { readonly ok: false; readonly errors: PlaygroundErrors }

/**
 * Split a paper budget across token0/token1 the way a concentrated position
 * would hold it at the current price.
 *
 * - `currentPrice <= lowerPrice` → position is 100% token0 (the pool has sold
 *   all of its quote while the price fell through the range floor).
 * - `currentPrice >= upperPrice` → position is 100% token1 (all token0 was
 *   sold while the price rose through the range ceiling).
 * - Inside the range → split from the Uniswap v3 value formulas. With
 *   liquidity `L`, the two legs are worth
 *     value0 ∝ √P·(√u − √P)/√u   and   value1 ∝ √P − √l
 *   so the token0 share flows continuously from 1 (at the lower bound) to 0
 *   (at the upper bound): the closer the price is to the lower bound the more
 *   token0 the position holds, and the closer to the upper bound the more
 *   token1 — matching the boundary cases above rather than jumping at them.
 */
export function allocatePositionAmounts(input: AllocatePositionInput): AllocationResult {
  const range = validatePlaygroundRange(input)
  const errors: PlaygroundErrors = { ...range.errors }

  if (!Number.isFinite(input.amountUsdOrToken) || input.amountUsdOrToken <= 0) {
    errors.amountUsdOrToken = "Enter an amount greater than zero."
  }
  if (Object.keys(errors).length > 0) {
    return { ok: false, errors }
  }

  const { amountUsdOrToken: budget, currentPrice, lowerPrice, upperPrice } = input
  const side = positionStatus(currentPrice, lowerPrice, upperPrice)

  if (side === "below") {
    return {
      ok: true,
      side,
      amount0: budget / currentPrice,
      amount1: 0,
      value0Usd: budget,
      value1Usd: 0,
      totalValueUsd: budget,
      token0Share: 1,
    }
  }

  if (side === "above") {
    return {
      ok: true,
      side,
      amount0: 0,
      amount1: budget,
      value0Usd: 0,
      value1Usd: budget,
      totalValueUsd: budget,
      token0Share: 0,
    }
  }

  const sqrtCurrent = Math.sqrt(currentPrice)
  const value0Weight = (sqrtCurrent * (Math.sqrt(upperPrice) - sqrtCurrent)) / Math.sqrt(upperPrice)
  const value1Weight = sqrtCurrent - Math.sqrt(lowerPrice)
  const token1Share = value1Weight / (value0Weight + value1Weight)

  const value1Usd = budget * token1Share
  const value0Usd = budget - value1Usd

  return {
    ok: true,
    side,
    amount0: value0Usd / currentPrice,
    amount1: value1Usd,
    value0Usd,
    value1Usd,
    totalValueUsd: budget,
    token0Share: value0Usd / budget,
  }
}

export type ScenarioSimulatorInput = {
  readonly currentPrice: number
  readonly lowerPrice: number
  readonly upperPrice: number
  readonly amount0: number
  readonly amount1: number
  readonly priceChangesPercent: readonly number[]
  /**
   * Optional flat pool fee in percent (e.g. 0.3 for a 0.30% pool). When set,
   * each in-range scenario gets a crude illustrative fee accrual — see
   * `simulatePriceScenarios`.
   */
  readonly feePercent?: number | undefined
}

export type PriceScenario = {
  readonly priceChangePercent: number
  readonly simulatedPrice: number
  readonly status: PositionStatus
  readonly value0Usd: number
  readonly value1Usd: number
  readonly totalValueUsd: number
  /** Percent change of the position value vs the entry value. */
  readonly changePercent: number
  readonly estimatedFeesUsd: number
}

export type ScenarioResult =
  | {
      readonly ok: true
      readonly entryValueUsd: number
      readonly scenarios: readonly PriceScenario[]
    }
  | { readonly ok: false; readonly errors: PlaygroundErrors }

/**
 * Value a held `{ amount0, amount1 }` basket under a list of price moves.
 *
 * Valuation is deliberately simple: `amount0 * price + amount1` (no
 * rebalancing into the CL shape as price moves, no IL beyond the split you
 * already hold). This keeps the paper simulator honest about being a
 * simulator.
 *
 * Fee accrual (only when `feePercent` is given) uses one transparent
 * assumption: each 1% of price movement proxies one unit of notional
 * turnover, so `fees ≈ entryValue · |Δ%| · feePercent`, and only while the
 * simulated price stays inside the range (an out-of-range position earns no
 * fees — that is the core CL trade-off this page teaches).
 */
export function simulatePriceScenarios(input: ScenarioSimulatorInput): ScenarioResult {
  const range = validatePlaygroundRange(input)
  const errors: PlaygroundErrors = { ...range.errors }

  if (!Number.isFinite(input.amount0) || input.amount0 < 0) {
    errors.amount0 = "Token amount cannot be negative."
  }
  if (!Number.isFinite(input.amount1) || input.amount1 < 0) {
    errors.amount1 = "Token amount cannot be negative."
  }
  if (
    (Number.isFinite(input.amount0) ? input.amount0 : 0) + (Number.isFinite(input.amount1) ? input.amount1 : 0) <= 0
  ) {
    errors.amount0 = errors.amount0 ?? "Position value must be greater than zero."
  }
  if (input.feePercent !== undefined && (!Number.isFinite(input.feePercent) || input.feePercent < 0)) {
    errors.currentPrice = errors.currentPrice ?? "Fee percent must be zero or positive."
  }
  if (Object.keys(errors).length > 0) {
    return { ok: false, errors }
  }

  const { currentPrice, lowerPrice, upperPrice, amount0, amount1, priceChangesPercent, feePercent } = input
  const entryValueUsd = amount0 * currentPrice + amount1
  const feeFraction = feePercent !== undefined ? feePercent / 100 : 0

  const scenarios: PriceScenario[] = priceChangesPercent.map((change) => {
    const simulatedPrice = currentPrice * (1 + change / 100)
    const status = positionStatus(simulatedPrice, lowerPrice, upperPrice)
    const value0Usd = amount0 * simulatedPrice
    const value1Usd = amount1
    const totalValueUsd = value0Usd + value1Usd
    const estimatedFeesUsd = status === "inside" ? entryValueUsd * (Math.abs(change) / 100) * feeFraction : 0

    return {
      priceChangePercent: change,
      simulatedPrice,
      status,
      value0Usd,
      value1Usd,
      totalValueUsd,
      changePercent: ((totalValueUsd - entryValueUsd) / entryValueUsd) * 100,
      estimatedFeesUsd,
    }
  })

  return { ok: true, entryValueUsd, scenarios }
}

const Q96 = 2 ** 96

/**
 * Token1-per-token0 price from a `sqrtPriceX96` string, assuming equal
 * (18/18) decimals. Fine for paper trading; the playground UI labels this
 * assumption. Loses precision for very large values — `Number` rounds above
 * 2^53, which only matters cosmetically at extreme prices.
 */
export function priceFromSqrtPriceX96(sqrtPriceX96: string): number {
  const ratio = Number(sqrtPriceX96) / Q96
  if (!Number.isFinite(ratio)) return 0
  return ratio * ratio
}

/** Token1-per-token0 price from a tick, ignoring token decimals. */
export function priceFromTick(tick: number): number {
  return 1.0001 ** tick
}
