const SAFE_IMAGE_PROTOCOLS: Record<string, true> = {
  "https:": true,
  "data:": true,
}

/**
 * Allow only https: (no mixed-content breakage, no cleartext) and data: image
 * URLs as <img> sources. Anything else — http:, ipfs:, javascript:, relative
 * paths — is rejected so untrusted token-list logoURI values cannot leak
 * referrers/IPs to arbitrary hosts or silently break on https pages.
 */
export function isSafeImageUrl(url: string): boolean {
  try {
    return SAFE_IMAGE_PROTOCOLS[new URL(url).protocol] === true
  } catch {
    return false
  }
}
