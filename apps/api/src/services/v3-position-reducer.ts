import type { V3LiquidityEvent } from "./v3-liquidity-events"

export type V3PositionState = {
  readonly tokenId: string
  readonly ownerAddress: `0x${string}` | null
  readonly isActive: boolean
  readonly liquidity: bigint
  readonly amount0: bigint
  readonly amount1: bigint
  readonly fees0: bigint
  readonly fees1: bigint
  readonly costBasis0: bigint
  readonly costBasis1: bigint
  readonly pendingPrincipal0: bigint
  readonly pendingPrincipal1: bigint
}

export function reduceV3PositionEvents(events: readonly V3LiquidityEvent[]): ReadonlyMap<string, V3PositionState> {
  const states = new Map<string, V3PositionState>()
  const ordered = [...events].sort(
    (left, right) => left.blockNumber - right.blockNumber || left.logIndex - right.logIndex,
  )
  for (const event of ordered) {
    if (event.tokenId === null) continue
    const previous =
      states.get(event.tokenId) ??
      ({
        tokenId: event.tokenId,
        ownerAddress: null,
        isActive: true,
        liquidity: 0n,
        amount0: 0n,
        amount1: 0n,
        fees0: 0n,
        fees1: 0n,
        costBasis0: 0n,
        costBasis1: 0n,
        pendingPrincipal0: 0n,
        pendingPrincipal1: 0n,
      } satisfies V3PositionState)
    const next = applyEvent(previous, event)
    if (next !== null) states.set(event.tokenId, next)
  }
  return states
}

function applyEvent(state: V3PositionState, event: V3LiquidityEvent): V3PositionState | null {
  if (event.eventType === "transfer") {
    return { ...state, ownerAddress: event.ownerAddress, isActive: event.ownerAddress !== null }
  }
  if (event.eventType === "collect") {
    const amount0 = toBigInt(event.amount0)
    const amount1 = toBigInt(event.amount1)
    const principal0 = amount0 < state.pendingPrincipal0 ? amount0 : state.pendingPrincipal0
    const principal1 = amount1 < state.pendingPrincipal1 ? amount1 : state.pendingPrincipal1
    return {
      ...state,
      fees0: state.fees0 + amount0 - principal0,
      fees1: state.fees1 + amount1 - principal1,
      pendingPrincipal0: state.pendingPrincipal0 - principal0,
      pendingPrincipal1: state.pendingPrincipal1 - principal1,
    }
  }
  const deltaLiquidity = toBigInt(event.liquidityDelta)
  const delta0 = toBigInt(event.amount0)
  const delta1 = toBigInt(event.amount1)
  if (event.eventType === "increase") {
    return {
      ...state,
      liquidity: state.liquidity + deltaLiquidity,
      amount0: state.amount0 + delta0,
      amount1: state.amount1 + delta1,
      costBasis0: state.costBasis0 + delta0,
      costBasis1: state.costBasis1 + delta1,
    }
  }
  if (event.eventType === "decrease") {
    if (deltaLiquidity > state.liquidity) return null
    const liquidity = state.liquidity - deltaLiquidity
    const amount0 = delta0 >= state.amount0 ? 0n : state.amount0 - delta0
    const amount1 = delta1 >= state.amount1 ? 0n : state.amount1 - delta1
    return {
      ...state,
      isActive: liquidity > 0n,
      liquidity,
      amount0,
      amount1,
      pendingPrincipal0: state.pendingPrincipal0 + delta0,
      pendingPrincipal1: state.pendingPrincipal1 + delta1,
    }
  }
  return state
}

function toBigInt(value: string | null): bigint {
  return value === null ? 0n : BigInt(value)
}
