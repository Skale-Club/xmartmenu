/**
 * phone.ts — customer phone numbers.
 *
 * Who may see an order is decided by identity, never by a fragment of a phone
 * number (EX-07). The last-8-digit key below used to match a typed checkout
 * phone with the OTP session phone; two different numbers ending in the same
 * eight digits saw each other's orders. It is still written for old rows and
 * reports, and must not be used for access.
 *
 * Access uses:
 *   - orders.customer_id: the phone-verified account that placed the order, or
 *     that later proved it owns the order's full number;
 *   - orders.customer_phone_e164: the typed number in E.164, only when it can
 *     be derived without guessing (an explicit +/00 prefix, or the
 *     restaurant's configured country). Ambiguous input stays NULL.
 */

/** @deprecated Legacy last-8-digit key. Never use it to decide who sees an order. */
export function phoneMatchKey(raw: string | null | undefined): string {
  const digits = (raw ?? '').replace(/\D/g, '')
  return digits.slice(-8)
}

/** Calling codes for the restaurant's configured country (ISO 3166 alpha-2 or a common name). */
const CALLING_CODES: Record<string, string> = {
  BR: '55', BRAZIL: '55', BRASIL: '55',
  US: '1', USA: '1', 'UNITED STATES': '1',
  CA: '1', CANADA: '1',
  PT: '351', PORTUGAL: '351',
  ES: '34', SPAIN: '34', ESPANA: '34', 'ESPAÑA': '34',
  MX: '52', MEXICO: '52', 'MÉXICO': '52',
  AR: '54', ARGENTINA: '54',
  CL: '56', CHILE: '56',
  CO: '57', COLOMBIA: '57',
  PE: '51', PERU: '51', 'PERÚ': '51',
  UY: '598', URUGUAY: '598',
  PY: '595', PARAGUAY: '595',
  GB: '44', UK: '44', 'UNITED KINGDOM': '44',
  FR: '33', FRANCE: '33',
  DE: '49', GERMANY: '49',
  IT: '39', ITALY: '39', ITALIA: '39',
}

export function callingCodeForCountry(country: string | null | undefined): string | null {
  const key = (country ?? '').trim().toUpperCase()
  return key ? CALLING_CODES[key] ?? null : null
}

const E164 = /^\+[1-9]\d{7,14}$/

/**
 * The number in E.164 ("+5511999998888"), or null when it cannot be known
 * without guessing. `country` is the restaurant's configured country: the
 * context a local number ("11 99999-8888") was typed in.
 */
export function toE164(raw: string | null | undefined, country?: string | null): string | null {
  const text = (raw ?? '').trim()
  if (!text) return null
  const digits = text.replace(/\D/g, '')
  let candidate: string | null = null
  if (text.startsWith('+')) candidate = `+${digits}`
  else if (text.startsWith('00')) candidate = `+${digits.slice(2)}`
  else {
    const code = callingCodeForCountry(country)
    if (!code) return null
    const national = digits.replace(/^0+/, '') // trunk prefix ("011 …")
    // Already carries the country code ("5511999998888"): national numbers are
    // at least 10 digits once the code is stripped for the countries we map.
    candidate = national.startsWith(code) && national.length - code.length >= 10
      ? `+${national}`
      : `+${code}${national}`
  }
  return candidate && E164.test(candidate) ? candidate : null
}

/** E.164 of a Supabase auth phone (stored as digits without "+"). */
export function sessionPhoneE164(phone: string | null | undefined): string | null {
  const digits = (phone ?? '').replace(/\D/g, '')
  const candidate = digits ? `+${digits}` : ''
  return E164.test(candidate) ? candidate : null
}
