/**
 * The public menu as a price list (showcase: guests can't order here — see
 * TenantCapabilities.showcase) and the contact links shown instead of a cart.
 *
 * Pure helpers: the dish sheet, the cards and the feed word prices with them,
 * and the WhatsApp / phone / Instagram links are normalized here so a number
 * typed as "(555) 123-4567" or an Instagram saved as "@handle" or a full URL
 * still produces a working link.
 */
import { buildSameAs } from '@/lib/seo'

/** The price-relevant part of an option group (GroupWithOptions satisfies it). */
export interface PricedOptionGroup {
  id: string
  name: string
  type: string
  options: Array<{ id: string; name: string; base_price: number | null; price_modifier: number }>
}

export type Money = (value: number) => string

/** "$60.00" for a size (base price), "+ $2.00" / "− $1.00" for a modifier, null when it costs nothing extra. */
export function formatOptionPrice(option: { base_price: number | null; price_modifier: number }, money: Money): string | null {
  if (option.base_price !== null && option.base_price !== undefined) return money(Number(option.base_price))
  const modifier = Number(option.price_modifier) || 0
  if (modifier === 0) return null
  return `${modifier > 0 ? '+' : '−'} ${money(Math.abs(modifier))}`
}

export interface PriceListRow {
  id: string
  name: string
  price: string | null
}

/** One option group as read-only rows: "Slice $15.00", "5-inch $60.00"… */
export function optionPriceList(group: PricedOptionGroup, money: Money): PriceListRow[] {
  return group.options.map(option => ({ id: option.id, name: option.name, price: formatOptionPrice(option, money) }))
}

/** "Slice $15.00 · 5-inch $60.00 · 10-inch $180.00" */
export function priceListText(group: PricedOptionGroup, money: Money): string {
  return optionPriceList(group, money)
    .map(row => (row.price ? `${row.name} ${row.price}` : row.name))
    .join(' · ')
}

/** Groups whose options set the dish's price (sizes): single or half-and-half with a base price. */
function sizeGroups(groups: readonly PricedOptionGroup[]): PricedOptionGroup[] {
  return groups.filter(g => (g.type === 'single' || g.type === 'half_and_half') && g.options.some(o => o.base_price !== null && o.base_price !== undefined))
}

/**
 * The price to show for a dish. When a group sets the price (sizes), the
 * lowest of those prices with `from: true` ("From $15.00") — unless every
 * size costs the same. Otherwise the dish's own price.
 */
export function displayPrice(productPrice: number, groups: readonly PricedOptionGroup[] | null | undefined): { amount: number; from: boolean } {
  const sized = sizeGroups(groups ?? [])
  if (!sized.length) return { amount: Number(productPrice) || 0, from: false }
  const candidates: number[] = []
  for (const group of sized) {
    for (const option of group.options) {
      candidates.push(option.base_price !== null && option.base_price !== undefined
        ? Number(option.base_price)
        : (Number(productPrice) || 0) + (Number(option.price_modifier) || 0))
    }
  }
  const amount = Math.min(...candidates)
  return { amount, from: new Set(candidates).size > 1 }
}

/**
 * The dish as named in a WhatsApp message from a showcase menu (nothing was
 * chosen): "Cake (Slice $15.00 · 5-inch $60.00)", or "Cake · $12.00" when it
 * has no sizes.
 */
export function showcaseItemText(name: string, productPrice: number, groups: readonly PricedOptionGroup[] | null | undefined, money: Money): string {
  const sized = sizeGroups(groups ?? [])
  if (sized.length) return `${name} (${priceListText(sized[0], money)})`
  return `${name} · ${money(Number(productPrice) || 0)}`
}

/**
 * The dish as named in a WhatsApp order with choices made:
 * "Cake (Size: 5-inch) · $60.00".
 */
export function orderedItemText(name: string, selectedOptions: Record<string, unknown> | null | undefined, unitPrice: number, money: Money): string {
  const chosen = Object.entries(selectedOptions ?? {})
    .filter(([, v]) => v !== null && v !== undefined && String(v).trim() !== '')
    .map(([k, v]) => `${k}: ${v}`)
    .join(', ')
  return `${name}${chosen ? ` (${chosen})` : ''} · ${money(unitPrice)}`
}

// ── Contact links ───────────────────────────────────────────────────────────

/** Digits only ("+1 (555) 123-4567" → "15551234567"); null when there is no usable number. */
export function whatsappDigits(raw: string | null | undefined): string | null {
  const digits = (raw ?? '').replace(/\D/g, '')
  return digits.length >= 6 ? digits : null
}

/** https://wa.me/<digits>[?text=…], or null without a usable number. */
export function whatsappUrl(raw: string | null | undefined, message?: string | null): string | null {
  const digits = whatsappDigits(raw)
  if (!digits) return null
  return message ? `https://wa.me/${digits}?text=${encodeURIComponent(message)}` : `https://wa.me/${digits}`
}

/** tel: link keeping only a leading + and digits; null without a usable number. */
export function telUrl(raw: string | null | undefined): string | null {
  const trimmed = (raw ?? '').trim()
  const digits = trimmed.replace(/\D/g, '')
  if (digits.length < 3) return null
  return `tel:${trimmed.startsWith('+') ? '+' : ''}${digits}`
}

/**
 * Instagram saved as "handle", "@handle" or a full profile URL: the URL
 * (same rule as the SEO sameAs links) and the "@handle" to show.
 */
export function instagramProfile(raw: string | null | undefined): { url: string; handle: string } | null {
  const value = raw?.trim()
  if (!value) return null
  const url = buildSameAs({ instagram: value })[0]
  if (!url) return null
  let handle = value.replace(/^@+/, '')
  if (/^https?:\/\//i.test(value)) {
    try {
      const segment = new URL(value).pathname.split('/').filter(Boolean)[0]
      handle = segment ?? ''
    } catch {
      handle = ''
    }
  }
  handle = handle.replace(/^@+/, '')
  return { url, handle: handle ? `@${handle}` : 'Instagram' }
}

export interface ContactLinks {
  whatsapp: string | null
  phone: { url: string; label: string } | null
  instagram: { url: string; handle: string } | null
}

/** The contact links a restaurant filled in, normalized; each null when missing or unusable. */
export function contactLinks(
  settings: { whatsapp?: string | null; phone?: string | null; instagram?: string | null } | null | undefined,
  whatsappMessage?: string | null,
): ContactLinks {
  const tel = telUrl(settings?.phone)
  return {
    whatsapp: whatsappUrl(settings?.whatsapp, whatsappMessage),
    phone: tel ? { url: tel, label: settings!.phone!.trim() } : null,
    instagram: instagramProfile(settings?.instagram),
  }
}
