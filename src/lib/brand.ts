/**
 * Single source for the product name and its public address.
 *
 * Pure constants and functions (no imports, no Node APIs): safe for the Edge
 * middleware and for client components. `platform_settings` (app_name,
 * brand_name, menu_footer_brand) still overrides the name at run time; these
 * are the fallbacks.
 */

export const BRAND_NAME = 'Xprout'
export const BRAND_HOST = 'xprout.app'
export const BRAND_URL = 'https://xprout.app'

/** Hosts that serve the product itself. */
export const BRAND_HOSTS: readonly string[] = ['xprout.app', 'www.xprout.app']

/**
 * Former addresses. They keep answering forever (restaurants have printed QR
 * codes), so they must never be mistaken for a tenant custom domain.
 */
export const LEGACY_HOSTS: readonly string[] = ['xmartmenu.skale.club', 'xmartmenu-stage.skale.club']

function hostOf(value: string): string {
  return value.trim().toLowerCase().split(':')[0]
}

/**
 * True when `host` is the product's own address: the current brand hosts, the
 * legacy hosts, or the host of NEXT_PUBLIC_APP_URL when set. The port is ignored.
 */
export function isPlatformHost(host: string): boolean {
  const normalized = hostOf(host)
  if (!normalized) return false
  if (BRAND_HOSTS.includes(normalized) || LEGACY_HOSTS.includes(normalized)) return true
  const configured = process.env.NEXT_PUBLIC_APP_URL
  if (!configured) return false
  return hostOf(configured.replace(/^https?:\/\//i, '').split('/')[0]) === normalized
}
