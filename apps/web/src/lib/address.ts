import { isAddress, getAddress } from "viem"

/**
 * Validate an Ethereum address using viem's built-in checksum validation.
 * @param address - The address to validate
 * @returns true if the address is valid
 */
export function isValidAddress(address: string): boolean {
  try {
    return isAddress(address)
  } catch {
    return false
  }
}

/**
 * Shorten an address for display: 0x1234...5678
 * @param address - The full address
 * @param chars - Number of characters to show on each side (default: 4)
 * @returns Shortened address or original if too short
 */
export function shortenAddress(address: string, chars = 4): string {
  if (!address) return ""
  if (address.length < chars * 2 + 4) return address
  return `${address.slice(0, chars + 2)}...${address.slice(-chars)}`
}

/**
 * Normalize an address to its checksummed version.
 * @param address - The address to normalize
 * @returns Checksummed address, or original if invalid
 */
export function normalizeAddress(address: string): string {
  try {
    return getAddress(address)
  } catch {
    return address
  }
}
