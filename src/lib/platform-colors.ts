import { BRAND_BASE, BRAND_PRIMARY } from '@/lib/brand'
import { computePrimaryForeground, safeCssColor } from '@/lib/color-utils'

/** One projection of platform settings; restaurant palettes are resolved separately. */
export function platformColors(configuredPrimary?: string | null) {
  const primary = safeCssColor(configuredPrimary, BRAND_PRIMARY)
  return {
    primary,
    onPrimary: primary.toLowerCase() === BRAND_PRIMARY.toLowerCase()
      ? BRAND_BASE
      : computePrimaryForeground(primary),
  }
}
