import { computePrimaryForeground, readableTextColor, safeCssColor } from '@/lib/color-utils'
import { BRAND_PRIMARY } from '@/lib/brand'

/** Payment surfaces keep the restaurant's palette; missing public facts use a platform fallback. */
export function checkoutTheme(tenant: unknown) {
  const row = Array.isArray(tenant) ? tenant[0] : tenant
  const embedded = row && typeof row === 'object' ? (row as Record<string, unknown>).tenant_settings : null
  const settings = (Array.isArray(embedded) ? embedded[0] : embedded) as Record<string, unknown> | null
  const primary = safeCssColor(typeof settings?.primary_color === 'string' ? settings.primary_color : null, BRAND_PRIMARY)
  const accent = safeCssColor(typeof settings?.accent_color === 'string' ? settings.accent_color : null, primary)
  return {
    primary,
    accent,
    onPrimary: computePrimaryForeground(primary, '#ffffff'),
    // The same light-price role as cards, details and option sheets; it also passes on white.
    accentText: readableTextColor(accent),
    focus: readableTextColor(primary, '#ffffff'),
  }
}
