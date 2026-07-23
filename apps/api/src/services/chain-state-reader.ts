/**
 * AetherDEX Chain State Reader — Phase 0 G2
 *
 * Abstracts the on-chain pool-state read behind an Effect service so the V4
 * quote engine's math is unit-testable without an RPC endpoint or deployed
 * contracts. The full indexer lands in Phase 3; until then the live
 * implementation reads a window of initialized ticks around the active price
 * from Uniswap V4's `StateView` contract (getSlot0 + getLiquidity +
 * getTickLiquidity), exactly what the quote engine needs for tick crossings.
 *
 * Contract addresses are deployment config (Phase-0 G5) — read from env,
 * never hardcoded. When `STATE_VIEW_ADDRESS` / `RPC_URL` are unset the
 * unconfigured layer fails with `reason: "not_configured"` so callers can
 * fall back to the legacy D1 approximation (rollback path per the plan).
 */

import { Token } from "@uniswap/sdk-core"
import { Pool } from "@uniswap/v4-sdk"
import { Context, Effect, Layer } from "effect"
import { createPublicClient, getAddress, http, isAddress } from "viem"
import type { InitializedTick, PoolChainState, PoolKeyParams } from "./quote-engine"

// ─── Service interface ──────────────────────────────────────────────────────

export class OnChainReadError {
  readonly _tag = "OnChainReadError"
  constructor(
    readonly reason: "not_configured" | "rpc_error" | "pool_not_initialized" | "invalid_pool_key",
    readonly message: string,
  ) {}
}

export interface ChainStateReader {
  readonly getPoolState: (key: PoolKeyParams) => Effect.Effect<PoolChainState, OnChainReadError>
}

export const ChainStateReader = Context.Service<ChainStateReader>("@aetherdex/ChainStateReader")

// ─── StateView ABI (only what we read) ──────────────────────────────────────

const STATE_VIEW_ABI = [
  {
    name: "getSlot0",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "poolId", type: "bytes32" }],
    outputs: [
      { name: "sqrtPriceX96", type: "uint160" },
      { name: "tick", type: "int24" },
      { name: "protocolFee", type: "uint24" },
      { name: "lpFee", type: "uint24" },
    ],
  },
  {
    name: "getLiquidity",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "poolId", type: "bytes32" }],
    outputs: [{ name: "liquidity", type: "uint128" }],
  },
  {
    name: "getTickLiquidity",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "poolId", type: "bytes32" },
      { name: "tick", type: "int24" },
    ],
    outputs: [
      { name: "liquidityGross", type: "uint128" },
      { name: "liquidityNet", type: "int128" },
    ],
  },
] as const

// ─── Config ─────────────────────────────────────────────────────────────────

export interface StateViewReaderConfig {
  /** JSON-RPC endpoint URL (env: RPC_URL). */
  readonly rpcUrl: string
  /** Deployed Uniswap V4 StateView address (env: STATE_VIEW_ADDRESS). */
  readonly stateViewAddress: `0x${string}`
  /** Chain id used to derive PoolIds (env: CHAIN_ID). */
  readonly chainId: number
  /**
   * How many tick-spacing steps to scan in EACH direction from the active
   * tick for initialized ticks. Windowed scan until the Phase-3 indexer.
   */
  readonly tickScanEachSide: number
}

// ─── Mock (unit tests) ──────────────────────────────────────────────────────

/**
 * Reader that resolves pool state from an in-memory map keyed by
 * `poolIdOf(key)`. Tests use this to drive exact single-tick / cross-tick cases.
 */
export const mockChainStateReaderLayer = (
  states: ReadonlyMap<string, PoolChainState>,
  keyToId: (key: PoolKeyParams) => string,
): Layer.Layer<ChainStateReader> =>
  Layer.succeed(ChainStateReader, {
    getPoolState: (key) => {
      const state = states.get(keyToId(key))
      if (!state) {
        return Effect.fail(new OnChainReadError("pool_not_initialized", `No mock state for ${keyToId(key)}`))
      }
      return Effect.succeed(state)
    },
  })

/** A reader that always fails `not_configured` — used when env lacks RPC/deployment config. */
export const unconfiguredChainStateReaderLayer: Layer.Layer<ChainStateReader> = Layer.succeed(ChainStateReader, {
  getPoolState: () =>
    Effect.fail(
      new OnChainReadError(
        "not_configured",
        "On-chain reads are not configured (missing STATE_VIEW_ADDRESS / RPC_URL) — wire them in Phase-0 G5",
      ),
    ),
})

// ─── Live (viem + StateView) ────────────────────────────────────────────────

/** Deterministic pool id used to key mock state and to query the StateView. */
export function poolIdOf(chainId: number, key: PoolKeyParams): string {
  // Validate + EIP-55-normalize BEFORE the Uniswap `Token` constructor, which throws
  // (or rejects non-checksummed input) on malformed addresses. Callers that run this
  // inside Effect.try map the rejection to OnChainReadError("invalid_pool_key") instead
  // of letting it escape as an uncaught constructor exception.
  if (!isAddress(key.token0)) throw new Error(`token0 is not a valid address: ${key.token0}`)
  if (!isAddress(key.token1)) throw new Error(`token1 is not a valid address: ${key.token1}`)
  const token0 = new Token(chainId, getAddress(key.token0), 18)
  const token1 = new Token(chainId, getAddress(key.token1), 18)
  return Pool.getPoolId(token0, token1, key.fee, key.tickSpacing, key.hooks)
}

const MAX_SCAN_EACH_SIDE = 512

export const makeStateViewReaderLayer = (config: StateViewReaderConfig): Layer.Layer<ChainStateReader> =>
  Layer.effect(
    ChainStateReader,
    Effect.sync((): ChainStateReader => {
      const client = createPublicClient({ transport: http(config.rpcUrl) })
      const stateView = config.stateViewAddress
      const scan = Math.min(Math.max(config.tickScanEachSide, 1), MAX_SCAN_EACH_SIDE)

      const getPoolState = (key: PoolKeyParams): Effect.Effect<PoolChainState, OnChainReadError> =>
        Effect.gen(function* () {
          const poolId = (yield* Effect.try({
            try: () => poolIdOf(config.chainId, key),
            catch: (e) =>
              new OnChainReadError(
                "invalid_pool_key",
                `Invalid pool key: ${e instanceof Error ? e.message : String(e)}`,
              ),
          })) as `0x${string}`

          // 1. Spot state: slot0 + current liquidity
          const [slot0, liquidity] = yield* Effect.tryPromise({
            try: () =>
              Promise.all([
                client.readContract({
                  address: stateView,
                  abi: STATE_VIEW_ABI,
                  functionName: "getSlot0",
                  args: [poolId],
                }),
                client.readContract({
                  address: stateView,
                  abi: STATE_VIEW_ABI,
                  functionName: "getLiquidity",
                  args: [poolId],
                }),
              ]),
            catch: (e) =>
              new OnChainReadError("rpc_error", `StateView read failed: ${e instanceof Error ? e.message : String(e)}`),
          })

          const sqrtPriceX96 = slot0[0]
          const tick = Number(slot0[1])
          if (sqrtPriceX96 === 0n) {
            return yield* Effect.fail(new OnChainReadError("pool_not_initialized", `Pool ${poolId} is not initialized`))
          }

          // 2. Initialized-tick window around the active tick (Phase-3 indexer replaces this scan).
          //    Anchored to tick-spacing BOUNDARIES: initialized ticks are always multiples of
          //    tickSpacing, but the active tick usually is NOT — scanning `tick ± k·spacing`
          //    would probe invalid ticks (same remainder as `tick`) and miss every crossing.
          //    Anchor to the boundary at/below the active tick and include it.
          const spacing = key.tickSpacing
          const anchor = Math.floor(tick / spacing) * spacing
          const candidates: number[] = [anchor]
          for (let k = 1; k <= scan; k += 1) {
            candidates.push(anchor - k * spacing)
            candidates.push(anchor + k * spacing)
          }

          // Parallel per-tick `getTickLiquidity` probes (Phase-3 indexer replaces
          // this windowed scan; no multicall3 dependency needed for the probes).
          const tickResults = yield* Effect.tryPromise({
            try: () =>
              Promise.all(
                candidates.map((t) =>
                  client.readContract({
                    address: stateView,
                    abi: STATE_VIEW_ABI,
                    functionName: "getTickLiquidity",
                    args: [poolId, t],
                  }),
                ),
              ),
            catch: (e) =>
              new OnChainReadError("rpc_error", `Tick scan failed: ${e instanceof Error ? e.message : String(e)}`),
          })

          const initializedTicks: InitializedTick[] = candidates
            .map((t, i) => {
              const result = tickResults[i]
              return { tick: t, liquidityGross: result?.[0] ?? 0n, liquidityNet: result?.[1] ?? 0n }
            })
            .filter((t) => t.liquidityNet !== 0n)
            .sort((a, b) => a.tick - b.tick)

          // The exact tick range this snapshot verified. Simulations that exit it are
          // rejected by the quote engine (ticks outside are unverified, not "uninitialized").
          const verifiedTickWindow: readonly [number, number] = [anchor - scan * spacing, anchor + scan * spacing]

          return { sqrtPriceX96, tick, liquidity, initializedTicks, verifiedTickWindow }
        })

      return { getPoolState }
    }),
  )
