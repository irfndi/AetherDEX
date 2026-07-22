/**
 * AetherDEX Token List validation — Phase 0 G4
 *
 * Validates the canonical Uniswap default token list JSON
 * (https://tokens.uniswap.org): schema shape + EIP-55 address checksums
 * (viem), filtered to the configured chain. AetherDEX serves NO custom/curated
 * token list — this is the only source of token metadata (scope lock).
 */

import { getAddress, isAddress } from "viem"

export interface ValidatedToken {
  readonly chainId: number
  /** EIP-55 checksummed address. */
  readonly address: string
  readonly symbol: string
  readonly name: string
  readonly decimals: number
  readonly logoURI: string | null
}

export class TokenListValidationError {
  readonly _tag = "TokenListValidationError"
  constructor(readonly message: string) {}
}

const MAX_TOKENS = 10_000

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/**
 * Parse + validate a token-list document, returning the tokens for `chainId`
 * with checksummed addresses. Invalid individual entries are dropped; a
 * structurally invalid document fails.
 */
export function validateTokenList(json: unknown, chainId: number): readonly ValidatedToken[] {
  if (!isRecord(json)) {
    throw new TokenListValidationError("Token list must be a JSON object")
  }
  const rawTokens = json.tokens
  if (!Array.isArray(rawTokens)) {
    throw new TokenListValidationError("Token list is missing a `tokens` array")
  }
  if (rawTokens.length > MAX_TOKENS) {
    throw new TokenListValidationError(`Token list exceeds ${MAX_TOKENS} entries`)
  }

  const seen = new Set<string>()
  const result: ValidatedToken[] = []

  for (const raw of rawTokens) {
    if (!isRecord(raw)) continue

    const rawChainId = raw.chainId
    if (typeof rawChainId !== "number" || !Number.isInteger(rawChainId) || rawChainId < 0) continue
    if (rawChainId !== chainId) continue

    const rawAddress = raw.address
    if (typeof rawAddress !== "string") continue
    // EIP-55: mixed-case addresses must carry a valid checksum
    if (!isAddress(rawAddress, { strict: true })) continue

    const rawDecimals = raw.decimals
    if (typeof rawDecimals !== "number" || !Number.isInteger(rawDecimals) || rawDecimals < 0 || rawDecimals > 255) {
      continue
    }

    const rawSymbol = raw.symbol
    const rawName = raw.name
    if (typeof rawSymbol !== "string" || rawSymbol.length === 0 || rawSymbol.length > 40) continue
    if (typeof rawName !== "string" || rawName.length === 0 || rawName.length > 200) continue

    const address = getAddress(rawAddress)
    if (seen.has(address)) continue
    seen.add(address)

    const rawLogo = raw.logoURI
    result.push({
      chainId,
      address,
      symbol: rawSymbol,
      name: rawName,
      decimals: rawDecimals,
      logoURI: typeof rawLogo === "string" && rawLogo.length > 0 ? rawLogo : null,
    })
  }

  return result
}
