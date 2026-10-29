import { buildTxExplorerUrl, buildAddressExplorerUrl } from '@/onchain-facts'

/**
 * Merchant-supplied text is rendered through React (escaped), and also stripped of control and
 * bidirectional-override characters so it cannot disguise itself or an address.
 */
export function sanitizeText(value: string | null | undefined, max = 120): string {
  if (!value) return ''
  // eslint-disable-next-line no-control-regex
  const cleaned = value.replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g, ' ').replace(/\s+/g, ' ').trim()
  return cleaned.length > max ? `${cleaned.slice(0, max - 1)}…` : cleaned
}

/** Only plain http(s) links are ever rendered as href, so a hostile value cannot become a javascript: URL. */
export function safeHttpUrl(value: string | null | undefined): string | null {
  if (!value) return null
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
    if (url.username || url.password) return null
    return url.toString()
  } catch {
    return null
  }
}

export const shortAddress = (address: string): string => (address.length > 12 ? `${address.slice(0, 6)}…${address.slice(-4)}` : address)

export function txUrl(chainId: number, hash: string): string | null {
  try {
    return buildTxExplorerUrl(chainId, hash)
  } catch {
    return null
  }
}

export function addressUrl(chainId: number, address: string): string | null {
  try {
    return buildAddressExplorerUrl(chainId, address)
  } catch {
    return null
  }
}

/** mm:ss from a number of milliseconds, never negative. */
export function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

export function formatWhen(iso: string | null | undefined): string {
  if (!iso) return '-'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '-' : d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

/** True for a plausible 0x EVM address. The API validates for real; this only guards the form. */
export const looksLikeAddress = (value: string): boolean => /^0x[0-9a-fA-F]{40}$/.test(value.trim())

/**
 * The origin of whatever the merchant pasted (scheme, host and port, no path, query or fragment),
 * or null if it is not an http(s) URL. Return origins are compared exactly, so a pasted page URL is cut down to this.
 */
export function toOrigin(value: string): string | null {
  const trimmed = value.trim()
  if (!trimmed) return null
  try {
    const url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`)
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
    return url.origin
  } catch {
    return null
  }
}
